import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import OrderStatusTimeline from '../../src/components/admin/OrderStatusTimeline.jsx'

describe('OrderStatusTimeline', () => {
  it('shows empty state when no logs', () => {
    render(<OrderStatusTimeline logs={[]} />)
    expect(screen.getByText(/Sin historial de cambios/i)).toBeTruthy()
  })

  it('renders one entry per log', () => {
    const logs = [
      { id: 'l1', fromStatus: null, toStatus: 'PENDING', createdAt: '2026-09-01T10:00:00Z', changedBy: null },
      { id: 'l2', fromStatus: 'PENDING', toStatus: 'CONFIRMED', createdAt: '2026-09-01T11:00:00Z', changedBy: { name: 'Admin' } },
    ]
    render(<OrderStatusTimeline logs={logs} />)
    // Status badges: PENDING and CONFIRMED
    expect(screen.getAllByText(/Pendiente/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Confirmado/).length).toBeGreaterThan(0)
  })

  it('shows the admin name when changedBy is present', () => {
    const logs = [
      {
        id: 'l1',
        fromStatus: 'PENDING',
        toStatus: 'SHIPPED',
        createdAt: '2026-09-01T10:00:00Z',
        changedBy: { name: 'Juan Pérez', email: 'j@p.com' },
      },
    ]
    render(<OrderStatusTimeline logs={logs} />)
    expect(screen.getByText(/Juan Pérez/i)).toBeTruthy()
  })

  it('renders the note when provided', () => {
    const logs = [
      {
        id: 'l1',
        fromStatus: null,
        toStatus: 'CONFIRMED',
        createdAt: '2026-09-01T10:00:00Z',
        changedBy: null,
        note: 'Pago verificado contra referencia',
      },
    ]
    render(<OrderStatusTimeline logs={logs} />)
    expect(screen.getByText(/Pago verificado contra referencia/)).toBeTruthy()
  })

  it('handles unknown status values gracefully', () => {
    const logs = [
      {
        id: 'l1',
        fromStatus: null,
        toStatus: 'WAT',
        createdAt: '2026-09-01T10:00:00Z',
        changedBy: null,
      },
    ]
    render(<OrderStatusTimeline logs={logs} />)
    // El componente debe renderizar el status crudo en lugar de crashear
    expect(screen.getAllByText('WAT').length).toBeGreaterThan(0)
  })
})
