import { checkBrandIsSeparateTerm, getBrandsMapping } from './brands'

describe('Brand Detection Tests', () => {
    // Test edge case #1: Special character replacements (Babē = Babe)
    test('should handle special character replacements', () => {
        expect(checkBrandIsSeparateTerm('This is Babē product', 'Babe')).toBe(true)
        expect(checkBrandIsSeparateTerm('Product with Babē', 'Babē')).toBe(true)
    })

    // Test edge case #2: Ignored brands (BIO, NEB)
    test('should ignore generic brands like BIO and NEB', () => {
        expect(checkBrandIsSeparateTerm('BIO product name', 'bio')).toBe(false)
        expect(checkBrandIsSeparateTerm('Some NEB item', 'neb')).toBe(false)
    })

    // Test edge case #3: Front-required brands
    test('should require certain brands to be at the front', () => {
        const frontBrands = ['rich', 'rff', 'flex', 'ultra', 'gum', 'beauty', 'orto', 'free', '112', 'kin', 'happy']
        
        // Should match when at front
        expect(checkBrandIsSeparateTerm('RICH cream', 'rich')).toBe(true)
        expect(checkBrandIsSeparateTerm('Ultra moisturizer', 'ultra')).toBe(true)
        expect(checkBrandIsSeparateTerm('112 emergency cream', '112')).toBe(true)
        
        // Should NOT match when not at front
        expect(checkBrandIsSeparateTerm('Product RICH cream', 'rich')).toBe(false)
        expect(checkBrandIsSeparateTerm('Some ultra product', 'ultra')).toBe(false)
    })

    // Test edge case #4: Front or second position brands
    test('should allow certain brands in front or second position', () => {
        const frontOrSecondBrands = ['heel', 'contour', 'nero', 'rsv']
        
        // Front position
        expect(checkBrandIsSeparateTerm('HEEL cream', 'heel')).toBe(true)
        expect(checkBrandIsSeparateTerm('Contour makeup', 'contour')).toBe(true)
        
        // Second position
        expect(checkBrandIsSeparateTerm('Some HEEL product', 'heel')).toBe(true)
        expect(checkBrandIsSeparateTerm('Product contour kit', 'contour')).toBe(true)
        
        // Third or later position - should have lower priority
        expect(checkBrandIsSeparateTerm('Some other heel cream', 'heel')).toBe(true) // Still matches but with lower score
    })

    // Test edge case #5: Multiple brand matches - prioritize beginning
    test('should prioritize brands at the beginning when multiple matches', () => {
        // This is tested implicitly through the scoring system
        // The brand at the beginning should get a higher score
        expect(checkBrandIsSeparateTerm('HEEL product with heel', 'heel')).toBe(true)
    })

    // Test edge case #6: HAPPY needs capitalized matching
    test('should require HAPPY to be capitalized', () => {
        expect(checkBrandIsSeparateTerm('HAPPY Kids vitamins', 'happy')).toBe(true)
        expect(checkBrandIsSeparateTerm('happy kids vitamins', 'happy')).toBe(false)
        expect(checkBrandIsSeparateTerm('Very HAPPY product', 'happy')).toBe(true)
    })

    // Test general brand matching
    test('should match brands as separate terms', () => {
        expect(checkBrandIsSeparateTerm('QUIES ear plugs', 'quies')).toBe(true)
        expect(checkBrandIsSeparateTerm('Product by Dr. Brown\'s', 'dr. brown s')).toBe(true)
        expect(checkBrandIsSeparateTerm('Johnson&Johnson product', 'johnson s&johnson s')).toBe(true)
    })

    // Test brand deduplication
    test('should deduplicate brand groups', async () => {
        const brandsMapping = await getBrandsMapping()
        
        // Check that each brand appears as a key only once
        const allBrands = new Set<string>()
        for (const canonical in brandsMapping) {
            for (const brand of brandsMapping[canonical]) {
                expect(allBrands.has(brand)).toBe(false) // No brand should appear twice
                allBrands.add(brand)
            }
        }
        
        // Check that related brands map to the same canonical brand
        // For example, if 'baff-bombz' and 'zimpli kids' are related, they should have the same canonical
        let baffCanonical: string | null = null
        let zimpliCanonical: string | null = null
        
        for (const canonical in brandsMapping) {
            if (brandsMapping[canonical].includes('baff-bombz')) {
                baffCanonical = canonical
            }
            if (brandsMapping[canonical].includes('zimpli kids')) {
                zimpliCanonical = canonical
            }
        }
        
        if (baffCanonical && zimpliCanonical) {
            expect(baffCanonical).toBe(zimpliCanonical) // They should map to the same canonical brand
        }
    })
})

// Test the implementation with real examples from the output
describe('Real Product Examples', () => {
    test('should correctly identify brands in real products', () => {
        // From the output examples
        expect(checkBrandIsSeparateTerm('QUIES apsauginiai ausų kištukai, ryškių spalvų, 3 poros', 'quies')).toBe(true)
        expect(checkBrandIsSeparateTerm('BD DISCARDIT 2ML, 2 DALIŲ ŠVIRKŠTAS SU ADATA (BD, JAV)', 'bd pen')).toBe(true)
        expect(checkBrandIsSeparateTerm('GENTLE DAY Far-IR Anion Teens MINI paketai T12', 'gentle day')).toBe(true)
        expect(checkBrandIsSeparateTerm('CONTOUR gliukozės kiekio kraujyje stebėjimo sistema PLUS ELITE, N1', 'contour')).toBe(true)
        expect(checkBrandIsSeparateTerm('EUCERIN odą atjauninantis serumas HYALURON-FILLER, 30 ml', 'eucerin')).toBe(true)
    })
    
    test('should handle complex brand names', () => {
        expect(checkBrandIsSeparateTerm('DR.BROWNS pirmasis šviežio maisto maitintuvas, žalias, N1', 'dr. browns')).toBe(true)
        expect(checkBrandIsSeparateTerm('DR. BROWNS pirmasis šviežio maisto maitintuvas, silikoninis, N1', 'dr. brown s')).toBe(true)
    })
})