# Fair Oaks Realty Group Website

A luxury real estate website for fairoaksrealtygroup.com, built with Next.js 14 and Payload CMS.

## Quick Start

### Prerequisites

- Node.js 18+
- A Supabase account (for PostgreSQL database)
- A Vercel account (for deployment)

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

Then fill in your credentials:

- **DATABASE_URL**: Get from Supabase Dashboard > Project Settings > Database > Connection string
- **PAYLOAD_SECRET**: Generate a random string (e.g., `openssl rand -hex 32`)
- **BLOB_READ_WRITE_TOKEN**: Get from Vercel Blob Storage

### 3. Set Up Supabase Database

1. Go to [supabase.com](https://supabase.com) and create a new project
2. In Project Settings > Database, copy the connection string (use "Transaction pooler" for serverless)
3. Add the connection string to your `.env.local` as `DATABASE_URL`

### 4. Run Database Migrations

```bash
npm run build
```

This will create the necessary tables in your Supabase database.

### 5. Start Development Server

```bash
npm run dev
```

Visit:
- **Website**: http://localhost:3000
- **Admin Panel**: http://localhost:3000/admin

### 6. Create Admin User

On first visit to `/admin`, you'll be prompted to create an admin account.

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (main)/            # Main layout pages
│   │   ├── page.tsx       # Homepage
│   │   ├── listings/      # Listings pages
│   │   └── contact/       # Contact page
│   ├── welcome/           # Sign/QR landing page
│   └── api/               # API routes
├── collections/           # Payload CMS collections
├── components/            # React components
│   ├── ui/               # Base UI components
│   ├── layout/           # Header, Footer
│   ├── home/             # Homepage sections
│   └── property/         # Property-related components
├── globals/              # Payload CMS globals
└── lib/                  # Utility functions
```

## Key Features

- **Homepage** with hero, featured listings, neighborhoods, testimonials
- **/welcome** landing page optimized for yard sign QR codes
- **Listings** page with property cards
- **Contact** page with lead capture form
- **Admin Panel** at /admin for content management

## Deployment to Vercel

1. Push your code to GitHub
2. Import the repository in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Supabase PostgreSQL connection string | Yes |
| `PAYLOAD_SECRET` | Secret for Payload CMS | Yes |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage token | Yes |
| `RESEND_API_KEY` | Resend API key for emails | No (for leads) |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | reCAPTCHA site key | No (spam protection) |

## Next Steps

1. Add your own content in the admin panel
2. Replace stock images with real property photos
3. Connect IDX Broker for MLS search
4. Set up email sending with Resend
5. Configure Google Analytics

## Documentation

See the `/fairoaksrealtygroup-website-spec` folder for complete documentation:

- Design system and brand guidelines
- Page layouts and wireframes
- Component specifications
- Data models
- Admin UX guide
- IDX integration strategy
- Launch checklist
