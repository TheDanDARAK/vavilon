import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Unified UI feedback: small non-blocking toasts for short statuses and a
 * themed modal for confirmations and long reports. Replaces native
 * alert()/confirm(), which block the whole window and look out of place.
 */

export type FeedbackTone = 'info' | 'success' | 'warning' | 'error'

export interface MessageOptions {
  title?: string
  message: string
  tone?: FeedbackTone
  /** Text of the primary button (default "OK") */
  confirmLabel?: string
  /** Text of the secondary button; null hides it (default in `show`) */
  cancelLabel?: string | null
  /** Styles the primary button as destructive */
  danger?: boolean
}

interface DialogState extends MessageOptions {
  resolve: (confirmed: boolean) => void
}

interface ToastItem {
  id: number
  message: string
  tone: FeedbackTone
}

export interface FeedbackApi {
  /** Fire-and-forget status line; auto-dismisses. */
  toast: (message: string, tone?: FeedbackTone) => void
  /** Modal message with a single button. */
  show: (options: MessageOptions | string) => Promise<void>
  /** Modal question; resolves true when the primary button is chosen. */
  confirm: (options: MessageOptions | string) => Promise<boolean>
}

const FeedbackContext = createContext<FeedbackApi | null>(null)

const TONE_TITLE: Record<FeedbackTone, string> = {
  info: 'Сообщение',
  success: 'Готово',
  warning: 'Внимание',
  error: 'Ошибка'
}

const TONE_ICON: Record<FeedbackTone, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕'
}

function normalize(options: MessageOptions | string): MessageOptions {
  return typeof options === 'string' ? { message: options } : options
}

export function FeedbackProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const dialogRef = useRef<DialogState | null>(null)
  const nextId = useRef(0)

  const dismiss = useCallback((id: number): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const toast = useCallback((message: string, tone: FeedbackTone = 'info'): void => {
    const id = ++nextId.current
    setToasts((current) => [...current.slice(-3), { id, message, tone }])
  }, [])

  const openDialog = useCallback(
    (options: MessageOptions, withCancel: boolean): Promise<boolean> =>
      new Promise((resolve) => {
        // an older dialog should not hang forever if a second one is requested
        dialogRef.current?.resolve(false)
        const state: DialogState = {
          ...options,
          title: options.title ?? TONE_TITLE[options.tone ?? 'info'],
          confirmLabel: options.confirmLabel ?? 'OK',
          cancelLabel: withCancel
            ? options.cancelLabel === undefined
              ? 'Отмена'
              : options.cancelLabel
            : (options.cancelLabel ?? null),
          resolve
        }
        dialogRef.current = state
        setDialog(state)
      }),
    []
  )

  const close = useCallback((confirmed: boolean): void => {
    const current = dialogRef.current
    if (!current) return
    dialogRef.current = null
    setDialog(null)
    current.resolve(confirmed)
  }, [])

  const show = useCallback(
    async (options: MessageOptions | string): Promise<void> => {
      await openDialog(normalize(options), false)
    },
    [openDialog]
  )

  const confirm = useCallback(
    (options: MessageOptions | string): Promise<boolean> =>
      openDialog(normalize(options), true),
    [openDialog]
  )

  const api = useMemo<FeedbackApi>(() => ({ toast, show, confirm }), [toast, show, confirm])

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="feedback-layer">
          <div className="feedback-toasts" aria-live="polite">
            {toasts.map((item) => (
              <Toast key={item.id} item={item} onDone={dismiss} />
            ))}
          </div>
          {dialog && <Dialog state={dialog} onClose={close} />}
        </div>,
        document.body
      )}
    </FeedbackContext.Provider>
  )
}

export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext)
  if (!api) throw new Error('useFeedback must be used inside <FeedbackProvider>')
  return api
}

function Toast({ item, onDone }: { item: ToastItem; onDone: (id: number) => void }): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => onDone(item.id), item.tone === 'error' ? 7000 : 4500)
    return () => clearTimeout(timer)
  }, [item.id, item.tone, onDone])

  return (
    <div className={`feedback-toast tone-${item.tone}`} role="status">
      <span className="feedback-toast-icon">{TONE_ICON[item.tone]}</span>
      <span className="feedback-toast-text">{item.message}</span>
      <button className="feedback-toast-close" title="Закрыть" onClick={() => onDone(item.id)}>
        ✕
      </button>
    </div>
  )
}

function Dialog({
  state,
  onClose
}: {
  state: DialogState
  onClose: (confirmed: boolean) => void
}): React.JSX.Element {
  const okRef = useRef<HTMLButtonElement>(null)
  const tone = state.tone ?? 'info'

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose(false)
      }
    }
    window.addEventListener('keydown', onKey)
    const frame = requestAnimationFrame(() => okRef.current?.focus())
    return () => {
      window.removeEventListener('keydown', onKey)
      cancelAnimationFrame(frame)
    }
  }, [onClose])

  return (
    <div className="overlay feedback-overlay" onClick={() => onClose(false)}>
      <div
        className="dialog feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={state.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h3>
            <span className={`feedback-dialog-icon tone-${tone}`}>{TONE_ICON[tone]}</span>
            {state.title}
          </h3>
        </div>
        <div className="feedback-message">{state.message}</div>
        <div className="dialog-actions">
          {state.cancelLabel && (
            <button className="btn" onClick={() => onClose(false)}>
              {state.cancelLabel}
            </button>
          )}
          <button
            ref={okRef}
            className={state.danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => onClose(true)}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
