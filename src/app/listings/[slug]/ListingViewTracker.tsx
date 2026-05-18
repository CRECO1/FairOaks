'use client';
import { useEffect } from 'react';
import { trackViewItem } from '@/lib/analytics';

interface Props {
  id: string;
  name: string;
  price?: number;
  city?: string;
  beds?: number;
  baths?: number;
  property_type?: string;
}

export function ListingViewTracker({ id, name, price, city, beds, baths, property_type }: Props) {
  useEffect(() => {
    trackViewItem({ id, name, price, city, beds, baths, property_type });
  }, [id, name, price, city, beds, baths, property_type]);
  return null;
}
