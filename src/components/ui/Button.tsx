'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  // Improved base: larger text, better focus ring, smooth transitions
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-body-sm font-semibold tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-gold text-primary hover:bg-gold-dark active:bg-gold-dark shadow-sm hover:shadow-md',
        secondary:
          'bg-primary text-white hover:bg-primary/90 active:bg-primary/80 shadow-sm hover:shadow-md',
        outline:
          'border-2 border-primary bg-transparent text-primary hover:bg-primary hover:text-white',
        ghost:
          'bg-transparent text-primary hover:bg-primary/5',
        link:
          'text-gold underline-offset-4 hover:underline',
      },
      size: {
        // Increased sizes for better touch targets (seniors)
        sm: 'h-11 px-5 text-body-sm',      // Was h-10, text-caption
        md: 'h-13 px-7 text-body-sm',      // Was h-12 px-6 - now 52px height
        lg: 'h-[3.75rem] px-10 text-body', // Was h-14 px-8 - now 60px height
        xl: 'h-16 px-12 text-body-lg',     // New extra large option - 64px
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      asChild = false,
      loading = false,
      icon,
      iconPosition = 'left',
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    if (asChild) {
      return (
        <Slot
          className={cn(buttonVariants({ variant, size, fullWidth, className }))}
          ref={ref}
          {...props}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          icon && iconPosition === 'left' && <span className="mr-2">{icon}</span>
        )}
        {children}
        {icon && iconPosition === 'right' && !loading && (
          <span className="ml-2">{icon}</span>
        )}
      </button>
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
