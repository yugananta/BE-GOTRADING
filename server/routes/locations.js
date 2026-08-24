// server/routes/locations.js
//
// Publik (tidak requireAuth) -- dipakai form registrasi & dropdown lokasi
// sebelum user punya akun/token.

import { Router } from 'express';
import {
  listCountries, searchCountries, getCountryByIso2,
  listProvinces, searchProvinces, listCities, searchCities,
} from '../services/locationService.js';

const router = Router();

router.get('/countries', async (req, res, next) => {
  try {
    const { q, limit } = req.query;
    res.json(q ? await searchCountries(q, Number(limit) || 20) : await listCountries());
  } catch (err) { next(err); }
});

router.get('/countries/:iso2', async (req, res, next) => {
  try {
    res.json(await getCountryByIso2(req.params.iso2.toUpperCase()));
  } catch (err) { next(err); }
});

router.get('/countries/:countryId/provinces', async (req, res, next) => {
  try {
    const { q, limit } = req.query;
    const countryId = Number(req.params.countryId);
    res.json(q ? await searchProvinces(countryId, q, Number(limit) || 20) : await listProvinces(countryId));
  } catch (err) { next(err); }
});

router.get('/provinces/:provinceId/cities', async (req, res, next) => {
  try {
    const { q, limit } = req.query;
    const provinceId = Number(req.params.provinceId);
    res.json(q ? await searchCities(provinceId, q, Number(limit) || 20) : await listCities(provinceId));
  } catch (err) { next(err); }
});

// [ALIAS] Frontend (useLocationCascade.ts) memanggil bentuk query-param
// (?countryId=, ?provinceId=) bukan path-param. Disediakan sebagai alias
// supaya tidak perlu ubah frontend, tanpa menghapus bentuk path-param di
// atas (dipakai tempat lain / lebih RESTful).
router.get('/provinces', async (req, res, next) => {
  try {
    const { countryId, q, limit } = req.query;
    if (!countryId) return res.status(400).json({ error: 'countryId wajib diisi' });
    const id = Number(countryId);
    res.json(q ? await searchProvinces(id, q, Number(limit) || 20) : await listProvinces(id));
  } catch (err) { next(err); }
});

router.get('/cities', async (req, res, next) => {
  try {
    const { provinceId, q, limit } = req.query;
    if (!provinceId) return res.status(400).json({ error: 'provinceId wajib diisi' });
    const id = Number(provinceId);
    res.json(q ? await searchCities(id, q, Number(limit) || 20) : await listCities(id));
  } catch (err) { next(err); }
});

export default router;
