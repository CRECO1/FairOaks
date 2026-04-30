'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  inputSize?: 'md' | 'lg';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, inputSize = 'md', id, ...props }, ref) => {
    const inputId = id || React.useId();

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-2.5 block text-body-sm font-semibold text-primary"
          >
            {label}
            {props.required && <span className="ml-1 text-destructive">*</span>}
          </label>
        )}
        <input
          type={type}
          id={inputId}
          className={cn(
            // Improved: larger text, better border, larger rounded corners
            'flex w-full rounded-lg border-2 border-border bg-background px-5 text-body text-primary transition-all duration-200',
            // Better placeholder contrast (using light instead of muted)
            'placeholder:text-foreground-light',
            // Stronger focus state for visibility
            'focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/20',
            'disabled:cursor-not-allowed disabled:opacity-50',
            // Increased heights for better touch targets
            inputSize === 'md' && 'h-14',           // Was h-12 (48px → 56px)
            inputSize === 'lg' && 'h-16 text-body-lg', // Was h-14 (56px → 64px)
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
Input.displayName = 'Input';

export { Input };
