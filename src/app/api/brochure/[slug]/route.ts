import { NextRequest, NextResponse } from 'next/server';
import { getListingBySlug } from '@/lib/supabase';
import { formatPrice } from '@/lib/utils';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const listing = await getListingBySlug(slug);

    if (!listing) {
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }

    // Build a simple HTML brochure as PDF using jsPDF
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

    // Header
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('Fair Oaks Realty Group', 20, 25);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150);
    doc.text('(210) 390-9997 | info@fairoaksrealtygroup.com', 20, 32);
    doc.setTextColor(0);

    // Divider
    doc.setDrawColor(201, 169, 98);
    doc.setLineWidth(0.5);
    doc.line(20, 36, 190, 36);

    // Property Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(listing.title, 20, 48);

    // Address
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`${listing.address}, ${listing.city}, ${listing.state} ${listing.zip}`, 20, 56);

    // Price
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(201, 169, 98);
    doc.text(formatPrice(listing.price), 20, 68);
    doc.setTextColor(0);

    // Key Details
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Property Details', 20, 82);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    const details = [
      `Bedrooms: ${listing.bedrooms}`,
      `Bathrooms: ${listing.bathrooms}`,
      `Living Area: ${listing.sqft.toLocaleString()} sq ft`,
      listing.lot_size ? `Lot Size: ${listing.lot_size}` : '',
      listing.year_built ? `Year Built: ${listing.year_built}` : '',
      listing.mls_number ? `MLS #: ${listing.mls_number}` : '',
    ].filter(Boolean);

    details.forEach((d, i) => {
      doc.text(d, 20 + (i % 2) * 90, 92 + Math.floor(i / 2) * 8);
    });

    // Description
    if (listing.description) {
      const yPos = 92 + Math.ceil(details.length / 2) * 8 + 10;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('About This Home', 20, yPos);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(listing.description, 170);
      doc.text(lines, 20, yPos + 8);
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      'Fair Oaks Realty Group · 7510 FM 1560 N, Ste 101, Fair Oaks Ranch TX 78015 · TREC License #12345678',
      105,
      265,
      { align: 'center' }
    );

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slug}-brochure.pdf"`,
      },
    });
  } catch (err) {
    console.error('Brochure generation error:', err);
    return NextResponse.json({ error: 'Failed to generate brochure' }, { status: 500 });
  }
}
