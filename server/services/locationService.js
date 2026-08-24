// server/services/locationService.js
import { supabase } from '../integrations/supabase/client.js';

// Bentuk respons disamakan dengan interface `Country`/`Province`/`City` di
// frontend (db/schema.ts): iso_code & dial_code, bukan iso2/phonecode.
function mapCountry(c) {
  return { id: c.id, name: c.name, iso_code: c.iso2, dial_code: c.phonecode, iso3: c.iso3, currency: c.currency, emoji: c.emoji };
}

export async function listCountries() {
  const { data, error } = await supabase.from('countries').select('*').order('name');
  if (error) throw error;
  return (data || []).map(mapCountry);
}

export async function searchCountries(keyword, limit = 20) {
  const { data, error } = await supabase
    .from('countries').select('*').ilike('name', `%${keyword}%`).limit(limit);
  if (error) throw error;
  return (data || []).map(mapCountry);
}

export async function getCountryByIso2(iso2) {
  const { data, error } = await supabase.from('countries').select('*').eq('iso2', iso2).maybeSingle();
  if (error) throw error;
  return data ? mapCountry(data) : null;
}

export async function listProvinces(countryId) {
  const { data, error } = await supabase
    .from('provinces').select('*').eq('country_id', countryId).order('name');
  if (error) throw error;
  return data || [];
}

export async function searchProvinces(countryId, keyword, limit = 20) {
  const { data, error } = await supabase
    .from('provinces').select('*').eq('country_id', countryId).ilike('name', `%${keyword}%`).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function listCities(provinceId) {
  const { data, error } = await supabase
    .from('cities').select('*').eq('province_id', provinceId).order('name');
  if (error) throw error;
  return data || [];
}

export async function searchCities(provinceId, keyword, limit = 20) {
  const { data, error } = await supabase
    .from('cities').select('*').eq('province_id', provinceId).ilike('name', `%${keyword}%`).limit(limit);
  if (error) throw error;
  return data || [];
}
