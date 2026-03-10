/**
 * Pricing calculator for logistics orders
 * Base rate: £5.00
 * Weight: £1.20 per kg
 * Distance: £0.85 per km
 * Fragile surcharge: £3.00
 * VAT: 20%
 */

const BASE_RATE = 5.00;
const RATE_PER_KG = 1.20;
const RATE_PER_KM = 0.85;
const FRAGILE_SURCHARGE = 3.00;
const VAT_RATE = 0.20;

/**
 * Estimate distance from UK postcodes using a simplified lookup.
 * In production, use Google Maps Distance Matrix API or similar.
 */
function estimateDistanceKm(postcodeFrom, postcodeTo) {
  // Extract postcode area (first letters)
  const getArea = (pc) => pc.trim().toUpperCase().replace(/\s+/g, '').slice(0, 2);
  const from = getArea(postcodeFrom);
  const to = getArea(postcodeTo);

  if (from === to) return 5; // Same area ~5km

  // Rough UK area coordinates for distance estimation
  const areaCoords = {
    'E1': [51.515, -0.072], 'EC': [51.517, -0.107], 'N1': [51.536, -0.103],
    'NW': [51.545, -0.143], 'SE': [51.488, -0.063], 'SW': [51.487, -0.145],
    'W1': [51.513, -0.144], 'WC': [51.517, -0.121], 'W2': [51.512, -0.186],
    'B1': [52.480, -1.890], 'B2': [52.480, -1.890], 'M1': [53.480, -2.242],
    'M2': [53.480, -2.242], 'LS': [53.797, -1.549], 'SH': [53.382, -1.465],
    'BS': [51.454, -2.588], 'EH': [55.953, -3.188], 'G1': [55.861, -4.251],
    'CF': [51.483, -3.168], 'BN': [50.827, -0.139], 'SO': [50.908, -1.404],
    'OX': [51.752, -1.257], 'CB': [52.205, 0.119], 'CO': [51.895, 0.891],
    'IP': [52.057, 1.155], 'NR': [52.630, 1.298], 'PE': [52.573, -0.241],
    'LE': [52.636, -1.131], 'CV': [52.408, -1.510], 'NN': [52.241, -0.897],
    'MK': [52.041, -0.759], 'LU': [51.878, -0.414], 'AL': [51.753, -0.338],
    'SG': [51.902, -0.229], 'CM': [51.736, 0.480], 'SS': [51.571, 0.710],
    'DA': [51.446, 0.218], 'ME': [51.272, 0.529], 'CT': [51.279, 1.086],
    'TN': [51.133, 0.263], 'RH': [51.236, -0.125], 'GU': [51.236, -0.570],
    'KT': [51.370, -0.306], 'CR': [51.373, -0.099], 'SM': [51.401, -0.194],
    'PO': [50.820, -1.088], 'RG': [51.456, -1.000], 'SL': [51.511, -0.595],
    'HP': [51.752, -0.481], 'WD': [51.659, -0.396], 'EN': [51.658, -0.073],
    'HA': [51.580, -0.336], 'UB': [51.541, -0.477], 'TW': [51.449, -0.334],
    'EX': [50.726, -3.527], 'PL': [50.371, -4.142], 'TR': [50.264, -5.051],
    'TA': [51.015, -3.100], 'BA': [51.380, -2.358], 'DT': [50.714, -2.440],
    'SP': [51.070, -1.794], 'GL': [51.866, -2.238], 'HR': [52.057, -2.715],
    'WR': [52.193, -2.220], 'ST': [52.807, -2.118], 'TF': [52.704, -2.490],
    'SY': [52.707, -2.754], 'WV': [52.585, -2.129], 'WS': [52.582, -1.979],
    'DY': [52.513, -2.096], 'SK': [53.405, -2.157], 'WA': [53.391, -2.597],
    'CH': [53.191, -2.891], 'CW': [53.097, -2.443], 'DE': [52.922, -1.476],
    'NG': [52.950, -1.151], 'LN': [53.227, -0.541], 'DN': [53.523, -1.130],
    'HU': [53.745, -0.336], 'YO': [53.960, -1.082], 'HG': [54.000, -1.540],
    'BD': [53.795, -1.752], 'HX': [53.725, -1.862], 'HD': [53.648, -1.785],
    'WF': [53.682, -1.500], 'S1': [53.382, -1.465], 'DN': [53.523, -1.130],
    'DH': [54.776, -1.570], 'SR': [54.906, -1.381], 'NE': [54.978, -1.618],
    'TS': [54.574, -1.234], 'DL': [54.522, -1.558], 'LA': [54.047, -2.801],
    'PR': [53.765, -2.698], 'FY': [53.820, -3.050], 'BB': [53.750, -2.481],
    'BL': [53.578, -2.429], 'OL': [53.541, -2.118], 'HG': [54.000, -1.540],
    'CA': [54.895, -2.934], 'TD': [55.648, -2.780], 'KA': [55.612, -4.496],
    'PA': [55.846, -4.430], 'FK': [56.002, -3.784], 'DD': [56.462, -2.970],
    'PH': [56.398, -3.437], 'AB': [57.150, -2.112], 'IV': [57.478, -4.223]
  };

  const fromCoords = areaCoords[from] || [52.0, -1.5];
  const toCoords = areaCoords[to] || [52.0, -1.5];

  // Haversine formula
  const R = 6371;
  const dLat = (toCoords[0] - fromCoords[0]) * Math.PI / 180;
  const dLng = (toCoords[1] - fromCoords[1]) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(fromCoords[0] * Math.PI / 180) * Math.cos(toCoords[0] * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;

  return Math.max(2, Math.round(distance * 10) / 10);
}

function calculatePrice({ weightKg, pickupPostcode, deliveryPostcode, fragile = false }) {
  const distanceKm = estimateDistanceKm(pickupPostcode, deliveryPostcode);

  const baseRate = BASE_RATE;
  const weightCharge = Math.round(weightKg * RATE_PER_KG * 100) / 100;
  const distanceCharge = Math.round(distanceKm * RATE_PER_KM * 100) / 100;
  const fragileCharge = fragile ? FRAGILE_SURCHARGE : 0;

  const subtotal = Math.round((baseRate + weightCharge + distanceCharge + fragileCharge) * 100) / 100;
  const vat = Math.round(subtotal * VAT_RATE * 100) / 100;
  const total = Math.round((subtotal + vat) * 100) / 100;

  return {
    baseRate,
    weightCharge,
    distanceCharge,
    fragileCharge,
    subtotal,
    vat,
    total,
    distanceKm,
    currency: 'GBP'
  };
}

module.exports = { calculatePrice, estimateDistanceKm };