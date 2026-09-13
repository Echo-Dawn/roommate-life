import {
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import {
  type ChoreStatus,
  type PactVersionStatus,
  type ShareStatus,
  type SupplyStatus,
} from '../domain/types';
import { IconClose } from './Icon';

/* --------------------------------- 头像 --------------------------------- */

export function Avatar({ text, large = false }: { text: string; large?: boolean }) {
  return <span className={`avatar${large ? ' avatar--lg' : ''}`}>{text}</span>;
}

/* --------------------------------- 徽标 --------------------------------- */

const SHARE_LABEL: Record<ShareStatus, string> = {
  own: '本人承担',
  zero: '无需支付',
  unpaid: '待付款',
  awaiting_confirm: '待收款确认',
  settled: '已结清',
};

const SHARE_CLASS: Record<ShareStatus, string> = {
  own: 'badge--own',
  zero: 'badge--own',
  unpaid: 'badge--unpaid',
  awaiting_confirm: 'badge--awaiting',
  settled: 'badge--settled',
};

export function ShareBadge({ status }: { status: ShareStatus }) {
  return <span className={`badge ${SHARE_CLASS[status]}`}>{SHARE_LABEL[status]}</span>;
}

export function DisputeBadge() {
  return <span className="badge badge--dispute">有异议</span>;
}

const CHORE_LABEL: Record<ChoreStatus, string> = {
  pending: '待完成',
  done: '已完成',
  overdue: '待补做',
};

const CHORE_CLASS: Record<ChoreStatus, string> = {
  pending: 'badge--awaiting',
  done: 'badge--settled',
  overdue: 'badge--unpaid',
};

export function ChoreBadge({ status }: { status: ChoreStatus }) {
  return <span className={`badge ${CHORE_CLASS[status]}`}>{CHORE_LABEL[status]}</span>;
}

const SUPPLY_LABEL: Record<SupplyStatus, string> = {
  ok: '充足',
  low: '快用完',
  out: '已用完',
};

export function SupplyBadge({ status }: { status: SupplyStatus }) {
  return <span className={`badge badge--${status}`}>{SUPPLY_LABEL[status]}</span>;
}

const PACT_LABEL: Record<PactVersionStatus, string> = {
  pending: '待确认',
  active: '生效中',
  withdrawn: '已撤回',
  superseded: '已失效',
};

const PACT_CLASS: Record<PactVersionStatus, string> = {
  pending: 'badge--awaiting',
  active: 'badge--settled',
  withdrawn: 'badge--dispute',
  superseded: 'badge--own',
};

export function PactBadge({ status }: { status: PactVersionStatus }) {
  return <span className={`badge ${PACT_CLASS[status]}`}>{PACT_LABEL[status]}</span>;
}

/* --------------------------------- 空态 --------------------------------- */

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/* --------------------------------- 字段 --------------------------------- */

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}

export function Field({ label, hint, error, children, htmlFor }: FieldProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      className={`input${invalid ? ' input--invalid' : ''}${className ? ` ${className}` : ''}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export function Select({ invalid, className, ...rest }: SelectProps) {
  return (
    <select
      className={`select${invalid ? ' select--invalid' : ''}${className ? ` ${className}` : ''}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={`textarea${invalid ? ' textarea--invalid' : ''}${className ? ` ${className}` : ''}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      className={`checkbox${checked ? ' checkbox--checked' : ''}`}
      htmlFor={id}
      style={disabled ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/* --------------------------------- 弹窗 --------------------------------- */

export function Modal({
  title,
  subtitle,
  onClose,
  footer,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        style={wide ? { width: 'min(760px, 100%)' } : undefined}
      >
        <div className="modal__head">
          <div>
            <h3 style={{ fontSize: 17 }}>{title}</h3>
            {subtitle ? (
              <div className="small muted" style={{ marginTop: 4 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="关闭">
            <IconClose />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* --------------------------------- 其他 --------------------------------- */

export function Amount({ cents, large = false }: { cents: number; large?: boolean }) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return (
    <span className={`amount${large ? ' amount--lg' : ''}`}>
      {sign}¥{yuan.toLocaleString('zh-CN')}.{`${fen}`.padStart(2, '0')}
    </span>
  );
}

export function Banner({
  kind = 'info',
  icon,
  children,
  actions,
}: {
  kind?: 'info' | 'warn' | 'error';
  icon?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={`banner banner--${kind}`}>
      {icon}
      <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
      {actions ? <div className="banner__actions">{actions}</div> : null}
    </div>
  );
}
