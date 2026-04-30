#!/bin/bash
# Deploy script for Fair Oaks Realty Group website
# Run this in your terminal from the fair-oaks-realty-group folder

echo "Deploying Fair Oaks Realty Group website..."
echo ""

# Check if logged in to Vercel
if ! vercel whoami &>/dev/null; then
    echo "Not logged in to Vercel. Running login..."
    vercel login
fi

# Deploy to production
echo "Deploying to production..."
vercel --prod

echo ""
echo "Deployment complete!"
echo "Visit your Vercel deployment URL /admin to verify the fix"
