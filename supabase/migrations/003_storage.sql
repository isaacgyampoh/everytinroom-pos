-- ============================================================================
-- 003: STORAGE BUCKETS FOR IMAGES
-- Run in Supabase SQL Editor AFTER 001_schema.sql
-- ============================================================================

-- Create storage buckets for product images and invoice photos
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('invoice-photos', 'invoice-photos', true) ON CONFLICT DO NOTHING;

-- Allow public read access
CREATE POLICY "Public read product images" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
CREATE POLICY "Public read invoice photos" ON storage.objects FOR SELECT USING (bucket_id = 'invoice-photos');

-- Allow anon uploads
CREATE POLICY "Anon upload product images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images');
CREATE POLICY "Anon upload invoice photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'invoice-photos');
CREATE POLICY "Anon delete product images" ON storage.objects FOR DELETE USING (bucket_id = 'product-images');
CREATE POLICY "Anon delete invoice photos" ON storage.objects FOR DELETE USING (bucket_id = 'invoice-photos');
