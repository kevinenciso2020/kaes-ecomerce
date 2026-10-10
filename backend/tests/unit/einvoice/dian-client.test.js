import { describe, it, expect, vi } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { SignedXml } from 'xml-crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { buildSignedEnvelope, createDianClient, dianFileName, zipBase64, DianSoapError } from '../../../src/services/einvoice/dian-client.js'
import { testCert, testCertPem } from '../../helpers/einvoice.js'

const responseEnvelope = (inner) =>
  '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">' +
  '<s:Header><a:Action s:mustUnderstand="1">http://wcf.dian.colombia/IWcfDianCustomerServices/SendBillSyncResponse</a:Action></s:Header>' +
  `<s:Body>${inner}</s:Body></s:Envelope>`

const appResponse = '<ApplicationResponse>OK</ApplicationResponse>'

const acceptedResponse = responseEnvelope(
  '<SendBillSyncResponse xmlns="http://wcf.dian.colombia"><SendBillSyncResult xmlns:b="http://schemas.datacontract.org/2004/07/DianResponse" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
  '<b:ErrorMessage xmlns:c="http://schemas.microsoft.com/2003/10/Serialization/Arrays"/>' +
  '<b:IsValid>true</b:IsValid><b:StatusCode>00</b:StatusCode><b:StatusDescription>Procesado Correctamente.</b:StatusDescription>' +
  '<b:StatusMessage>La Factura electrónica SETP990000001, ha sido autorizada.</b:StatusMessage>' +
  `<b:XmlBase64Bytes>${Buffer.from(appResponse).toString('base64')}</b:XmlBase64Bytes><b:XmlBytes i:nil="true"/>` +
  '<b:XmlDocumentKey>abc123</b:XmlDocumentKey><b:XmlFileName>fv09003731150002600000001</b:XmlFileName>' +
  '</SendBillSyncResult></SendBillSyncResponse>',
)

const rejectedResponse = responseEnvelope(
  '<SendBillSyncResponse xmlns="http://wcf.dian.colombia"><SendBillSyncResult xmlns:b="http://schemas.datacontract.org/2004/07/DianResponse" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">' +
  '<b:ErrorMessage xmlns:c="http://schemas.microsoft.com/2003/10/Serialization/Arrays">' +
  '<c:string>Regla: FAD06, Rechazo: Valor del CUFE no está calculado correctamente.</c:string>' +
  '<c:string>Regla: FAJ44b, Notificación: Nit o Documento de Identificación informado No se encuentra registrado en el RUT.</c:string>' +
  '</b:ErrorMessage><b:IsValid>false</b:IsValid><b:StatusCode>99</b:StatusCode>' +
  '<b:StatusDescription>Validación contiene errores en campos mandatorios.</b:StatusDescription>' +
  '<b:XmlBase64Bytes i:nil="true"/><b:XmlDocumentKey>abc123</b:XmlDocumentKey>' +
  '</SendBillSyncResult></SendBillSyncResponse>',
)

describe('buildSignedEnvelope (WS-Security)', () => {
  it('firma wsa:To con exc-c14n y la firma es verificable', () => {
    const endpoint = 'https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc'
    const xml = buildSignedEnvelope({
      action: 'http://wcf.dian.colombia/IWcfDianCustomerServices/GetStatus',
      bodyXml: '<wcf:GetStatus><wcf:trackId>abc</wcf:trackId></wcf:GetStatus>',
      endpoint,
      cert: testCert(),
    })
    const dom = new DOMParser().parseFromString(xml, 'text/xml')
    const signature = dom.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0]
    const sig = new SignedXml({ publicCert: testCertPem })
    sig.loadSignature(signature)
    expect(sig.checkSignature(xml)).toBe(true)
    expect(xml).toContain(`>${endpoint}</wsa:To>`)
    expect(xml).toContain('wsse:BinarySecurityToken')

    const tampered = xml.replace(`>${endpoint}</wsa:To>`, '>https://evil.example.com</wsa:To>')
    const sig2 = new SignedXml({ publicCert: testCertPem })
    sig2.loadSignature(new DOMParser().parseFromString(tampered, 'text/xml').getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0])
    expect(sig2.checkSignature(tampered)).toBe(false)
  })
})

describe('createDianClient', () => {
  const makeClient = (data, status = 200) => {
    const http = { post: vi.fn().mockResolvedValue({ status, data }) }
    return { http, client: createDianClient({ environment: '1', cert: testCert(), http }) }
  }

  it('sendBillSync interpreta una factura autorizada y decodifica el ApplicationResponse', async () => {
    const { http, client } = makeClient(acceptedResponse)
    const r = await client.sendBillSync('z.zip', 'UEsDBA==')
    expect(r).toMatchObject({ isValid: true, statusCode: '00', errors: [], applicationResponse: appResponse })
    const [url, body, opts] = http.post.mock.calls[0]
    expect(url).toBe('https://vpfe.dian.gov.co/WcfDianCustomerServices.svc')
    expect(body).toContain('<wcf:fileName>z.zip</wcf:fileName>')
    expect(opts.headers['Content-Type']).toBe('application/soap+xml;charset=UTF-8;action="http://wcf.dian.colombia/IWcfDianCustomerServices/SendBillSync"')
  })

  it('sendBillSync devuelve los errores de validación de una factura rechazada', async () => {
    const { client } = makeClient(rejectedResponse)
    const r = await client.sendBillSync('z.zip', 'x')
    expect(r.isValid).toBe(false)
    expect(r.statusCode).toBe('99')
    expect(r.errors).toHaveLength(2)
    expect(r.errors[0]).toContain('FAD06')
    expect(r.applicationResponse).toBeNull()
  })

  it('un SOAP Fault lanza DianSoapError', async () => {
    const fault = responseEnvelope('<s:Fault><s:Code><s:Value>s:Sender</s:Value></s:Code><s:Reason><s:Text xml:lang="es-CO">Error de autenticación</s:Text></s:Reason></s:Fault>')
    const { client } = makeClient(fault, 500)
    await expect(client.getStatus('x')).rejects.toThrow('DIAN: Error de autenticación')
  })

  it('un error de red es reintentable', async () => {
    const http = { post: vi.fn().mockRejectedValue(new Error('ETIMEDOUT')) }
    const client = createDianClient({ environment: '2', cert: testCert(), http })
    const err = await client.sendBillSync('z.zip', 'x').catch((e) => e)
    expect(err).toBeInstanceOf(DianSoapError)
    expect(err.retryable).toBe(true)
  })

  it('sendTestSetAsync devuelve el ZipKey', async () => {
    const { client } = makeClient(responseEnvelope(
      '<SendTestSetAsyncResponse xmlns="http://wcf.dian.colombia"><SendTestSetAsyncResult xmlns:b="http://schemas.datacontract.org/2004/07/UploadDocumentResponse"><b:ErrorMessageList/><b:ZipKey>c1b2-zip</b:ZipKey></SendTestSetAsyncResult></SendTestSetAsyncResponse>',
    ))
    expect(await client.sendTestSetAsync('z.zip', 'x', 'set-1')).toEqual({ zipKey: 'c1b2-zip', errors: [] })
  })
})

describe('utilidades', () => {
  it('dianFileName sigue la nomenclatura del anexo', () => {
    expect(dianFileName({ kind: 'fv', nit: '800197268', year: 2019, sequence: 17 })).toBe('fv08001972680001900000011.xml')
    expect(dianFileName({ kind: 'z', nit: '800197268', year: 2026, sequence: 255, ext: 'zip' })).toBe('z080019726800026000000ff.zip')
  })
  it('zipBase64 genera un ZIP con el XML', () => {
    const files = unzipSync(Buffer.from(zipBase64('a.xml', '<a>ñ</a>'), 'base64'))
    expect(strFromU8(files['a.xml'])).toBe('<a>ñ</a>')
  })
})
