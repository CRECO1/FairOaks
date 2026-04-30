import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { answers } = body;

    // Map quiz answers to neighborhood recommendations
    const recommendations = buildRecommendations(answers ?? {});

    return NextResponse.json({ success: true, recommendations });
  } catch (err) {
    console.error('Quiz report error:', err);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}

interface Recommendation {
  neighborhood: string;
  slug: string;
  matchScore: number;
  reasons: string[];
}

function buildRecommendations(answers: Record<string, unknown>): Recommendation[] {
  const recs: Recommendation[] = [
    {
      neighborhood: 'Fair Oaks Ranch',
      slug: 'fair-oaks-ranch',
      matchScore: 0,
      reasons: [],
    },
    {
      neighborhood: 'Boerne',
      slug: 'boerne',
      matchScore: 0,
      reasons: [],
    },
    {
      neighborhood: 'Helotes',
      slug: 'helotes',
      matchScore: 0,
      reasons: [],
    },
  ];

  const priorities = (answers.priorities as string[]) ?? [];
  const budget = answers.budget as string;
  const area = answers.area as string;

  if (priorities.includes('schools')) {
    recs[0].matchScore += 3;
    recs[0].reasons.push('Top-rated Boerne ISD schools');
    recs[1].matchScore += 3;
    recs[1].reasons.push('Highly rated Boerne ISD schools');
  }
  if (priorities.includes('acreage')) {
    recs[1].matchScore += 2;
    recs[1].reasons.push('Larger lot sizes available');
    recs[2].matchScore += 2;
    recs[2].reasons.push('Spacious wooded lots');
  }
  if (priorities.includes('views')) {
    recs[0].matchScore += 3;
    recs[0].reasons.push('Stunning Hill Country views');
  }
  if (priorities.includes('commute')) {
    recs[2].matchScore += 2;
    recs[2].reasons.push('Easy access to Loop 1604 & UTSA');
  }
  if (budget === 'under-400k' || budget === '400-600k') {
    recs[2].matchScore += 2;
    recs[2].reasons.push('More affordable price range');
  }
  if (budget === '900-1.2m' || budget === '1.2m-plus') {
    recs[0].matchScore += 2;
    recs[0].reasons.push('Luxury estates and acreage available');
  }
  if (area && area !== 'open') {
    recs.forEach(r => {
      if (r.slug === area) r.matchScore += 5;
    });
  }

  return recs
    .filter(r => r.matchScore > 0 || r.reasons.length > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 3);
}
