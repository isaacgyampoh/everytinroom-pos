-- ============================================
-- EVERYTINROOM POS - STANDARDIZE CATEGORIES
-- Run this in Supabase SQL Editor
-- ============================================

-- This updates product categories to the standard set.
-- Only run if you want to clean up existing category names.

-- Standard Categories for Everytin Room:
-- 1. Curtains
-- 2. Kitchenware
-- 3. Cookware Sets
-- 4. Racks
-- 5. Rods
-- 6. Chairs
-- 7. Carpets
-- 8. Home Appliances
-- 9. Blankets
-- 10. Bed Sheets
-- 11. Mats
-- 12. Pillows
-- 13. Towels & Covers
-- 14. Artefacts & Decor
-- 15. Other

-- Fix common misspellings / variations
UPDATE products SET category = 'Curtains' WHERE lower(category) IN ('curtain', 'curtains', 'curtain set', 'curtain sets');
UPDATE products SET category = 'Kitchenware' WHERE lower(category) IN ('kitchenware', 'kitchenwares', 'kitchen ware', 'kitchen wares', 'kitchen', 'kitchen items');
UPDATE products SET category = 'Cookware Sets' WHERE lower(category) IN ('cookware', 'cookware sets', 'cookware set', 'cooking set', 'cooking sets', 'pots', 'pans');
UPDATE products SET category = 'Racks' WHERE lower(category) IN ('rack', 'racks', 'shelf', 'shelves', 'storage rack');
UPDATE products SET category = 'Rods' WHERE lower(category) IN ('rod', 'rods', 'curtain rod', 'curtain rods');
UPDATE products SET category = 'Chairs' WHERE lower(category) IN ('chair', 'chairs', 'seating');
UPDATE products SET category = 'Carpets' WHERE lower(category) IN ('carpet', 'carpets', 'rug', 'rugs');
UPDATE products SET category = 'Home Appliances' WHERE lower(category) IN ('home appliances', 'human appliances', 'appliance', 'appliances', 'electronics');
UPDATE products SET category = 'Blankets' WHERE lower(category) IN ('blanket', 'blankets', 'duvet', 'duvets', 'comforter');
UPDATE products SET category = 'Bed Sheets' WHERE lower(category) IN ('bed sheet', 'bed sheets', 'bedsheet', 'bedsheets', 'sheet', 'sheets', 'bedding');
UPDATE products SET category = 'Mats' WHERE lower(category) IN ('mat', 'mats', 'door mat', 'floor mat', 'bathroom mat');
UPDATE products SET category = 'Pillows' WHERE lower(category) IN ('pillow', 'pillows', 'pillow case', 'pillowcase');
UPDATE products SET category = 'Towels & Covers' WHERE lower(category) IN ('towel', 'towels', 'tope', 'topes', 'cover', 'covers', 'table cover', 'table cloth');
UPDATE products SET category = 'Artefacts & Decor' WHERE lower(category) IN ('artefact', 'artefacts', 'artifact', 'artifacts', 'decor', 'decoration', 'decorations', 'flowers', 'flower', 'vase', 'aesthetics');
UPDATE products SET category = 'Other' WHERE category IS NULL OR category = '';
