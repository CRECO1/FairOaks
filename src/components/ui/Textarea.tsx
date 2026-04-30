'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const textareaId = id || React.useId();

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="mb-2.5 block text-body-sm font-semibold text-primary"
          >
            {label}
            {props.required && <span className="ml-1 text-destructive">*</span>}
          </label>
        )}
        <textarea
          id={textareaId}
          className={cn(
            // Improved: larger text, better border, larger padding
            'flex min-h-[140px] w-full rounded-lg border-2 border-border bg-background px-5 py-4 text-body text-primary leading-relaxed transition-all duration-200',
            // Better placeholder contrast
            'placeholder:text-foreground-light',
            // Stronger focus state
            'focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/20',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'resize-y',
            error && 'border-destructive focus:border-destructive focus:ring-destructive/20',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && (
          <p className="mt-2 text-body-sm font-medium text-destructive">{error}</p>
        )}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
