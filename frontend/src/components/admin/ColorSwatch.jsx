import React from 'react'

export default function ColorSwatch({ hex, name, size = 14, showName = true }) {
  const isWhite = (hex || '').toUpperCase() === '#FFFFFF' || (hex || '').toUpperCase() === '#FFF'
  const border  = isWhite ? '#ddd' : (hex || '#ccc')

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-hidden="true"
        style={{
          display:        'inline-block',
          width:          size,
          height:         size,
          borderRadius:   '50%',
          backgroundColor: hex || '#ccc',
          border:         `1px solid ${border}`,
          flexShrink:     0,
        }}
      />
      {showName && <span>{name}</span>}
    </span>
  )
}
