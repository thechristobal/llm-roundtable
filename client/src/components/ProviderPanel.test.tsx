// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import ProviderPanel from './ProviderPanel'
import type { AdapterErrorCategory, AdapterProvider } from '../../../shared/adapter-errors'
import type { PanelState, ProviderID } from '../types'

// vitest doesn't auto-run @testing-library/react cleanup — without this,
// each render() stacks another DOM into the same document and queries
// like getByRole('button') return duplicates from prior tests.
afterEach(cleanup)

function errorState(
  category: AdapterErrorCategory,
  retryable: boolean,
  message = 'stub',
  provider: AdapterProvider = 'openai',
): PanelState {
  return { status: 'error', error: { category, provider, message, retryable } }
}

// Each fixture deliberately pairs a category with a MISLEADING message from a
// different category, and rotates the provider away from openai. A wrong
// implementation that string-sniffs the message or keys off provider name
// would render the wrong callout and fail.
describe('ProviderPanel — treatment is keyed by error.category, not by message content or provider', () => {
  it('category=quota with message="authentication failed" and providerId=anthropic → "Quota exhausted" + Claude', () => {
    render(
      <ProviderPanel
        providerId={'anthropic' as ProviderID}
        state={errorState('quota', false, 'authentication failed', 'anthropic')}
      />,
    )
    expect(screen.getByText(/Quota exhausted/)).toBeTruthy()
    // Provider name comes from providerId prop, not message content.
    expect(screen.getByText(/Claude is out/)).toBeTruthy()
    // Misleading message must not surface for a known category.
    expect(screen.queryByText(/authentication failed/i)).toBeNull()
  })

  it('category=overloaded with message="quota exceeded" and providerId=google → "High demand" + Gemini', () => {
    render(
      <ProviderPanel
        providerId={'google' as ProviderID}
        state={errorState('overloaded', true, 'quota exceeded', 'google')}
      />,
    )
    expect(screen.getByText(/High demand/)).toBeTruthy()
    expect(screen.getByText(/Gemini is overloaded/)).toBeTruthy()
    // If any residual .includes("quota") existed, it would win over category
    // and render "Quota exhausted" instead. Assert it does not.
    expect(screen.queryByText(/Quota exhausted/)).toBeNull()
  })

  it('category=auth with message="high demand" and providerId=openai → "Authentication failed"', () => {
    render(
      <ProviderPanel
        providerId={'openai' as ProviderID}
        state={errorState('auth', false, 'high demand', 'openai')}
      />,
    )
    expect(screen.getByText(/Authentication failed/)).toBeTruthy()
    expect(screen.queryByText(/High demand/)).toBeNull()
  })

  it('category=timeout with message="overloaded" and providerId=google → "Timed out"', () => {
    render(
      <ProviderPanel
        providerId={'google' as ProviderID}
        state={errorState('timeout', true, 'overloaded', 'google')}
      />,
    )
    expect(screen.getByText(/Timed out/)).toBeTruthy()
    expect(screen.queryByText(/High demand/)).toBeNull()
  })

  it('category=unknown → raw message is the ONLY fallback surface', () => {
    // For unknown, we have no canonical copy, so the raw message must render.
    // This is also the negative control for the tests above: message text
    // does surface here, proving the earlier "queryByText(...) === null"
    // assertions weren't just a broken query.
    render(
      <ProviderPanel
        providerId={'anthropic' as ProviderID}
        state={errorState('unknown', false, 'some raw diagnostic 7f3', 'anthropic')}
      />,
    )
    expect(screen.getByText(/some raw diagnostic 7f3/)).toBeTruthy()
  })
})

describe('ProviderPanel — Retry button gates on error.retryable, not on category name', () => {
  it('retryable=true AND onReroll present → Retry visible', () => {
    render(<ProviderPanel providerId="openai" state={errorState('overloaded', true)} onReroll={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeTruthy()
  })

  it('retryable=false → Retry hidden even when onReroll is present (e.g., quota without retry-after)', () => {
    render(<ProviderPanel providerId="openai" state={errorState('quota', false)} onReroll={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull()
  })

  it('retryable=true but no onReroll (older round, not latest) → Retry hidden', () => {
    render(<ProviderPanel providerId="openai" state={errorState('overloaded', true)} />)
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull()
  })

  it('quota WITH retryAfterMs (retryable=true) → Retry visible', () => {
    // A quota error the server marks retryable (e.g., Retry-After header)
    // must show Retry — proving the gate is retryable, not category.
    render(<ProviderPanel providerId="openai" state={errorState('quota', true)} onReroll={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeTruthy()
  })
})
