import { Job } from "bullmq"
import { countryCodes, dbServers, EngineType } from "../config/enums"
import { ContextType } from "../libs/logger"
import { jsonOrStringForDb, jsonOrStringToJson, stringOrNullForDb, stringToHash } from "../utils"
import _ from "lodash"
import { sources } from "../sites/sources"
import items from "./../../pharmacyItems.json"
import connections from "./../../brandConnections.json"

type BrandsMapping = {
    [key: string]: string[]
}

export async function getBrandsMapping(): Promise<BrandsMapping> {
    const brandConnections = connections

    // Create a map to track brand relationships
    const brandMap = new Map<string, Set<string>>()

    brandConnections.forEach(({ manufacturer_p1, manufacturers_p2 }) => {
        const brand1 = manufacturer_p1.toLowerCase()
        const brands2 = manufacturers_p2.toLowerCase()
        const brand2Array = brands2.split(";").map((b) => b.trim())
        if (!brandMap.has(brand1)) {
            brandMap.set(brand1, new Set())
        }
        brand2Array.forEach((brand2) => {
            if (!brandMap.has(brand2)) {
                brandMap.set(brand2, new Set())
            }
            brandMap.get(brand1)!.add(brand2)
            brandMap.get(brand2)!.add(brand1)
        })
    })

    // IMPROVEMENT: Deduplicate brand groups by assigning a single canonical brand per group
    // This solves the issue where related brands like "baff-bombz" and "zimpli kids" 
    // would both appear in results. Now only one canonical brand per group is used.
    const canonicalBrands = new Map<string, string>()
    const visitedBrands = new Set<string>()

    brandMap.forEach((relatedBrands, brand) => {
        if (visitedBrands.has(brand)) return

        // Group all related brands together
        const brandGroup = new Set([brand, ...relatedBrands])
        // Use alphabetical sorting to ensure consistent canonical brand selection
        const sortedGroup = Array.from(brandGroup).sort()
        const canonicalBrand = sortedGroup[0]

        // Map every brand in the group to the same canonical brand
        brandGroup.forEach((b) => {
            canonicalBrands.set(b, canonicalBrand)
            visitedBrands.add(b)
        })
    })

    // Convert to final mapping where each canonical brand maps to all its variants
    const flatMapObject: Record<string, string[]> = {}

    canonicalBrands.forEach((canonical, brand) => {
        if (!flatMapObject[canonical]) {
            flatMapObject[canonical] = []
        }
        if (!flatMapObject[canonical].includes(brand)) {
            flatMapObject[canonical].push(brand)
        }
    })

    return flatMapObject
}

async function getPharmacyItems(countryCode: countryCodes, source: sources, versionKey: string, mustExist = true) {
    const finalProducts = items

    return finalProducts
}

function normalizeBrandName(brand: string): string {
    // EDGE CASE #1: Handle special character replacements (Babē = Babe)
    // This normalizes accented characters to their base form for consistent matching
    return brand
        .replace(/[ēĒ]/g, 'e') // Babē = Babe
        .replace(/[āĀ]/g, 'a')
        .replace(/[īĪ]/g, 'i')
        .replace(/[ōŌ]/g, 'o')
        .replace(/[ūŪ]/g, 'u')
        .toLowerCase()
        .trim()
}

function shouldIgnoreBrand(brand: string): boolean {
    // EDGE CASE #2: ignore BIO, NEB - these are too generic and cause false positives
    const ignoredBrands = ['bio', 'neb']
    return ignoredBrands.includes(brand.toLowerCase())
}

function getBrandMatchScore(input: string, brand: string): number {
    const normalizedInput = input.toLowerCase()
    const normalizedBrand = normalizeBrandName(brand)

    // Skip ignored brands early
    if (shouldIgnoreBrand(normalizedBrand)) {
        return 0
    }

    const words = normalizedInput.split(/\s+/)
    const brandWords = normalizedBrand.split(/\s+/)

    // EDGE CASE #3: RICH, RFF, flex, ultra, gum, beauty, orto, free, 112, kin, happy 
    // have to be in the front - these brands are only valid if they appear first
    const frontRequiredBrands = ['rich', 'rff', 'flex', 'ultra', 'gum', 'beauty', 'orto', 'free', '112', 'kin', 'happy']

    // EDGE CASE #4: heel, contour, nero, rsv in front or 2nd word
    // These brands are valid in first or second position
    const frontOrSecondBrands = ['heel', 'contour', 'nero', 'rsv']

    // EDGE CASE #6: HAPPY needs to be matched capitalized
    if (normalizedBrand === 'happy') {
        const happyRegex = /\bHAPPY\b/
        if (!happyRegex.test(input)) {
            return 0
        }
    }

    // Calculate position-based scoring for brand matching
    let positionScore = 0
    let matchFound = false

    // Also normalize the input for character replacement matching
    const normalizedInputWords = normalizeBrandName(input).split(/\s+/)

    for (let i = 0; i < words.length; i++) {
        const word = words[i]
        const normalizedWord = normalizedInputWords[i] || ''

        // Check if this word matches the brand (partial matching allowed)
        // Check both original and normalized versions for matching
        if (brandWords.some(bw =>
            word.includes(bw) || bw.includes(word) ||
            normalizedWord.includes(bw) || bw.includes(normalizedWord)
        )) {
            matchFound = true

            // EDGE CASE #5: if >1 brands matched, prioritize matching beginning
            // Position-based scoring system ensures consistent prioritization
            if (frontRequiredBrands.includes(normalizedBrand) && normalizedBrand !== 'happy') {
                // Most front-required brands must be at position 0
                positionScore = i === 0 ? 100 : 0 // Only match if at front
            } else if (normalizedBrand === 'happy') {
                // HAPPY is special - it needs capitalization but can be anywhere
                positionScore = i === 0 ? 100 : 50 // Allow at any position but prefer front
            } else if (frontOrSecondBrands.includes(normalizedBrand)) {
                positionScore = i === 0 ? 100 : i === 1 ? 90 : 30
            } else {
                // For other brands, prioritize beginning matches with decreasing score
                positionScore = i === 0 ? 100 : Math.max(50 - i * 10, 10)
            }
            break
        }
    }

    return matchFound ? positionScore : 0
}

export function checkBrandIsSeparateTerm(input: string, brand: string): boolean {
    return getBrandMatchScore(input, brand) > 0
}

export async function assignBrandIfKnown(countryCode: countryCodes, source: sources, job?: Job) {
    const context = { scope: "assignBrandIfKnown" } as ContextType

    // Get deduplicated brand mappings where each group has a single canonical brand
    const brandsMapping = await getBrandsMapping()

    const versionKey = "assignBrandIfKnown"
    let products = await getPharmacyItems(countryCode, source, versionKey, false)
    let counter = 0

    for (let product of products) {
        counter++

        if (product.m_id) {
            // Already exists in the mapping table, probably no need to update
            continue
        }

        // IMPROVEMENT: Store brand matches with their scores for intelligent selection
        // This replaces the simple array approach with a scoring system
        const brandMatches: { brand: string; score: number; canonicalBrand: string }[] = []


        for (const canonicalBrand in brandsMapping) {
            const relatedBrands = brandsMapping[canonicalBrand]

            for (const brand of relatedBrands) {
                const score = getBrandMatchScore(product.title, brand)
                if (score > 0) {
                    brandMatches.push({ brand, score, canonicalBrand })
                }
            }
        }

        // Sort by score descending, then by brand name for consistency
        // This ensures deterministic results when multiple brands have the same score
        brandMatches.sort((a, b) => {
            if (a.score !== b.score) {
                return b.score - a.score
            }
            return a.brand.localeCompare(b.brand)
        })

        // CRITICAL FIX: Select the best match and use its canonical brand
        // This ensures consistent brand assignment for the whole group
        // E.g., both "baff-bombz" and "zimpli kids" will always map to the same canonical brand
        const bestMatch = brandMatches.length > 0 ? brandMatches[0] : null
        const selectedBrand = bestMatch?.canonicalBrand || null

        const matchedBrandNames = brandMatches.map(m => m.brand)

        console.log(`${product.title} -> ${_.uniq(matchedBrandNames)} (selected: ${selectedBrand})`)

        const sourceId = product.source_id

        // Enhanced metadata for debugging and analysis
        const processingMeta = {
            matchedBrands: matchedBrandNames,
            selectedBrand,
            matchScores: brandMatches.map(m => ({ brand: m.brand, score: m.score }))
        }

        const key = `${source}_${countryCode}_${sourceId}`
        const uuid = stringToHash(key)

        // TODO: Insert the selectedBrand into the product mapping table
        // The selectedBrand should be used as the final brand assignment
        // This ensures consistency across all products in the same brand group

        // Future improvements to consider:
        // 1. Add fuzzy matching for brands with typos
        // 2. Consider brand frequency in the dataset for better canonical selection
        // 3. Add machine learning-based brand classification
        // 4. Implement brand confidence scoring
    }
}
