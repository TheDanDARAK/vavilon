import { useEffect, useRef } from 'react'

/**
 * Gamepad navigation for Big Picture mode (Gamepad API).
 *
 * Standard mapping: D-pad (12–15) or the left stick navigate, A (0) confirms,
 * B (1) goes back, Start (9) opens the exit prompt. Held directions auto-repeat
 * so moving through a long library does not require frantic tapping.
 */

export interface GamepadHandlers {
  onUp?: () => void
  onDown?: () => void
  onLeft?: () => void
  onRight?: () => void
  /** A button */
  onConfirm?: () => void
  /** B button */
  onBack?: () => void
  /** Start button */
  onMenu?: () => void
}

type Direction = 'up' | 'down' | 'left' | 'right'

const DEADZONE = 0.55
const REPEAT_MS = 170

function stickDirection(pad: Gamepad): Direction | null {
  const [x = 0, y = 0] = pad.axes
  if (Math.abs(x) > Math.abs(y)) {
    if (x < -DEADZONE) return 'left'
    if (x > DEADZONE) return 'right'
  } else {
    if (y < -DEADZONE) return 'up'
    if (y > DEADZONE) return 'down'
  }
  return null
}

function direction(pad: Gamepad): Direction | null {
  const pressed = (i: number): boolean => pad.buttons[i]?.pressed ?? false
  if (pressed(12)) return 'up'
  if (pressed(13)) return 'down'
  if (pressed(14)) return 'left'
  if (pressed(15)) return 'right'
  return stickDirection(pad)
}

function firstConnected(): Gamepad | null {
  if (typeof navigator.getGamepads !== 'function') return null
  for (const pad of navigator.getGamepads()) {
    if (pad && pad.connected) return pad
  }
  return null
}

export function useGamepad(handlers: GamepadHandlers): void {
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    let raf = 0
    let lastDir: Direction | null = null
    let lastFire = 0
    const buttonState: Record<string, boolean> = {}

    const fireDirection = (dir: Direction): void => {
      if (dir === 'up') ref.current.onUp?.()
      else if (dir === 'down') ref.current.onDown?.()
      else if (dir === 'left') ref.current.onLeft?.()
      else ref.current.onRight?.()
    }

    const edge = (name: keyof GamepadHandlers, pressed: boolean): void => {
      if (pressed && !buttonState[name]) ref.current[name]?.()
      buttonState[name] = pressed
    }

    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const pad = firstConnected()
      if (!pad) return
      const now = performance.now()
      const dir = direction(pad)
      if (dir) {
        if (dir !== lastDir || now - lastFire > REPEAT_MS) {
          fireDirection(dir)
          lastDir = dir
          lastFire = now
        }
      } else {
        lastDir = null
      }
      edge('onConfirm', pad.buttons[0]?.pressed ?? false)
      edge('onBack', pad.buttons[1]?.pressed ?? false)
      edge('onMenu', pad.buttons[9]?.pressed ?? false)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}
