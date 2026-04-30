import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Luxury Brand Colors - Texas Hill Country Inspired
        primary: {
          DEFAULT: '#1A1A1A',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#FAFAF8',
          foreground: '#1A1A1A',
        },
        // Rich gold palette
        gold: {
          DEFAULT: '#C9A962',
          light: '#E8DCC4',
          lighter: '#F5F0E6',
          dark: '#A68B4B',
          muted: '#D4C49A',
        },
        // Hill Country inspired accent colors
        hillcountry: {
          sage: '#8B9A7B',
          stone: '#9E9589',
          sky: '#7BA3B8',
          sunset: '#D4A574',
          oak: '#6B5B4F',
        },
        background: {
          DEFAULT: '#FFFFFF',
          muted: '#FAFAF8',
          cream: '#FAF8F5',
          warm: '#F7F5F2',
        },
        foreground: {
          DEFAULT: '#1A1A1A',
          muted: '#525252',      // Improved contrast: was #6B6B6B (4.5:1 → 7:1)
          light: '#6B6B6B',      // Improved contrast: was #8B8B8B (3.5:1 → 4.5:1)
          subtle: '#8B8B8B',     // For decorative elements only
        },
        border: {
          DEFAULT: '#E8E5E0',
          dark: '#D4D0C8',
          light: '#F0EDE8',
        },
        destructive: {
          DEFAULT: '#B91C1C',
          foreground: '#FFFFFF',
        },
        success: {
          DEFAULT: '#166534',
          foreground: '#FFFFFF',
        },
      },
      fontFamily: {
        // Premium typography pairing
        heading: ['Playfair Display', 'Georgia', 'Times New Roman', 'serif'],
        body: ['Source Sans Pro', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        accent: ['Cormorant Garamond', 'Georgia', 'serif'],
      },
      fontSize: {
        // Dramatic display sizes for luxury feel
        'display-xl': ['5rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
        'display-lg': ['4rem', { lineHeight: '1.1', letterSpacing: '-0.025em', fontWeight: '700' }],
        'display': ['3rem', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-sm': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '600' }],
        'heading-xl': ['2rem', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '600' }],
        'heading-lg': ['1.75rem', { lineHeight: '1.3', fontWeight: '600' }],
        'heading': ['1.5rem', { lineHeight: '1.35', fontWeight: '600' }],
        'heading-sm': ['1.25rem', { lineHeight: '1.4', fontWeight: '600' }],
        // Improved body sizes for better readability (senior-friendly)
        'body-xl': ['1.375rem', { lineHeight: '1.75', letterSpacing: '0.01em' }],  // 22px - extra large for emphasis
        'body-lg': ['1.25rem', { lineHeight: '1.75', letterSpacing: '0.01em' }],   // 20px - was 1.25rem
        'body': ['1.1875rem', { lineHeight: '1.75', letterSpacing: '0.01em' }],    // 19px - was 1.125rem (18px)
        'body-sm': ['1.0625rem', { lineHeight: '1.7', letterSpacing: '0.01em' }],  // 17px - was 1rem (16px)
        'caption': ['0.9375rem', { lineHeight: '1.6', letterSpacing: '0.01em' }],  // 15px - was 0.875rem (14px)
        'overline': ['0.8125rem', { lineHeight: '1.4', letterSpacing: '0.15em', fontWeight: '600' }], // 13px - was 0.75rem
      },
      spacing: {
        '13': '3.25rem',  // 52px - for buttons
        '18': '4.5rem',
        '22': '5.5rem',
        '26': '6.5rem',
        '30': '7.5rem',
      },
      borderRadius: {
        'xl': '16px',
        'lg': '12px',
        'md': '8px',
        'sm': '4px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.04)',
        'md': '0 4px 16px rgba(0, 0, 0, 0.06)',
        'lg': '0 8px 32px rgba(0, 0, 0, 0.08)',
        'xl': '0 16px 48px rgba(0, 0, 0, 0.1)',
        '2xl': '0 24px 64px rgba(0, 0, 0, 0.12)',
        'luxury': '0 20px 60px rgba(201, 169, 98, 0.15)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.06)',
        'card-hover': '0 12px 40px rgba(0, 0, 0, 0.12)',
        'inner-glow': 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out',
        'fade-in-up': 'fadeInUp 0.8s ease-out',
        'fade-in-down': 'fadeInDown 0.6s ease-out',
        'slide-up': 'slideUp 0.6s ease-out',
        'slide-down': 'slideDown 0.4s ease-out',
        'slide-in-right': 'slideInRight 0.6s ease-out',
        'slide-in-left': 'slideInLeft 0.6s ease-out',
        'scale-in': 'scaleIn 0.5s ease-out',
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 3s ease-in-out infinite',
        'ken-burns': 'kenBurns 20s ease-in-out infinite alternate',
        'parallax': 'parallax 1s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          '0%': { opacity: '0', transform: 'translateY(-20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(40px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(40px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-40px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        kenBurns: {
          '0%': { transform: 'scale(1)' },
          '100%': { transform: 'scale(1.1)' },
        },
        parallax: {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-20px)' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-gold': 'linear-gradient(135deg, #C9A962 0%, #E8DCC4 50%, #C9A962 100%)',
        'gradient-luxury': 'linear-gradient(180deg, rgba(26, 26, 26, 0.9) 0%, rgba(26, 26, 26, 0.6) 50%, rgba(26, 26, 26, 0.9) 100%)',
        'gradient-hero': 'linear-gradient(180deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0.2) 40%, rgba(0, 0, 0, 0.6) 100%)',
        'gradient-card': 'linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.8) 100%)',
        'texture-noise': "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
      },
      transitionTimingFunction: {
        'luxury': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'bounce-soft': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        '400': '400ms',
        '600': '600ms',
        '800': '800ms',
      },
    },
  },
  plugins: [],
};

export default config;
