// A fake EDGAR full-text search (efts.sec.gov/LATEST/search-index), shared by the SEC filings listener's tests, the worker's and the
// handoff test. Invented filers, filings and words only: the CIKs start at 9900000, above any the SEC has assigned, and every name
// says Example. It answers the way the real endpoint did on 2026-11-13 (src/sources/efts.mjs has the details):
//   - Elasticsearch's response shape, with the echo of the query the server ran, one hit per DOCUMENT, and no document text;
//   - quoted phrases in q must all appear, and OR makes alternatives; with no q, main documents only (sequence 1);
//   - forms match the root form; CIKs match only zero-padded; locationCodes is the business-address state; sics; items; from;
//   - pages of 100, and an error body with HTTP 200 for a page past 10,000;
//   - the entity lookup (keysTyped), by every word of a name or by CIK.
// Options simulate the rest: a CDN cache that ignores items and sics (`cache`, with `clock` and `ttlMs`), transient HTTP 500s
// (`fail500`), an error body for chosen requests (`errorFor`), a field dropped from every hit (`dropField`), and text the server
// should never send (`leakText`).
export const URL_EFTS = 'https://efts.sec.gov/LATEST/search-index';

export const FILERS = {
  hill: { cik: '0009900101', display: 'EXAMPLE HILL COUNTRY BANCSHARES, INC.  (EXHC)  (CIK 0009900101)', entity: 'EXAMPLE HILL COUNTRY BANCSHARES, INC. (EXHC)', tickers: 'EXHC', state: 'TX', sic: '6022', place: 'Exampleville, TX' },
  natl: { cik: '0009900102', display: 'Example National Holdings Corp  (EXNH)  (CIK 0009900102)', entity: 'Example National Holdings Corp (EXNH)', tickers: 'EXNH', state: 'SD', sic: '6021', place: 'Sample Falls, SD' },
  // A bank filer that is not in the FDIC list: only the discovery search finds it.
  desert: { cik: '0009900201', display: 'Example Desert Bancorp  (EXDB)  (CIK 0009900201)', entity: 'Example Desert Bancorp (EXDB)', tickers: 'EXDB', state: 'AZ', sic: '6022', place: 'Example Mesa, AZ' },
  // A non-bank whose name has every word of a holding company's name: a weaker suggestion, flagged by its SIC code.
  trust: { cik: '0009900301', display: 'EXAMPLE HILL COUNTRY BANCSHARES CAPITAL TRUST I  (CIK 0009900301)', entity: 'EXAMPLE HILL COUNTRY BANCSHARES CAPITAL TRUST I', tickers: '', state: 'TX', sic: '6798', place: 'Exampleville, TX' },
  // Not a bank: the discovery search's SIC filter keeps it out.
  grocer: { cik: '0009900401', display: 'Example Grocery Co  (EXGR)  (CIK 0009900401)', entity: 'Example Grocery Co (EXGR)', tickers: 'EXGR', state: 'TX', sic: '5411', place: 'Exampleville, TX' },
};

// One document of a filing. `seq` is a string on 8-K documents and a number on others, as in the real index.
const d = (adsh, filer, form, date, items, seq, name, fileType, text) => ({ adsh, filer, form, root: form.replace(/\/A$/, ''), date, items, seq, name, fileType, text });
export const ACC = {
  impairment: '0009999999-26-000501', heldForSale: '0009999999-26-000502', proxy: '0009999999-26-000503', loanSale: '0009999999-26-000504',
  acquisition: '0009999999-26-000505', otherEvent: '0009999999-26-000506', desertImpairment: '0009999999-26-000507', desertRepositioning: '0009999999-26-000508',
  grocer: '0009999999-26-000509', oldImpairment: '0009999999-26-000510', hill10q: '0009999999-26-000511', trust10k: '0009999999-26-000512', natl10k: '0009999999-26-000513',
};
// A sentence that must never be stored or reach the drafter: it stands for filing text.
export const SECRET_TEXT = 'Example Tower Plaza at 1 Example Way was written down to its appraised value';
export const PERSON = 'Jordan Example';
export const DOCS = () => [
  d(ACC.impairment, 'hill', '8-K', '2026-11-10', ['2.06', '9.01'], '1', 'exhc-8k-20261110.htm', '8-K', `item 2.06 material impairments. ${SECRET_TEXT}.`),
  d(ACC.impairment, 'hill', '8-K', '2026-11-10', ['2.06', '9.01'], '2', 'exhc-ex991.htm', 'EX-99.1', 'commercial real estate loans were reviewed for impairment'),
  d(ACC.heldForSale, 'hill', '8-K', '2026-11-11', ['2.02', '9.01'], '1', 'exhc-8k-20261111.htm', '8-K', 'results of operations and financial condition'),
  d(ACC.heldForSale, 'hill', '8-K', '2026-11-11', ['2.02', '9.01'], '2', 'exhc-ex991-q3.htm', 'EX-99.1', 'loans transferred to held for sale this quarter were commercial real estate loans. loans held for sale rose.'),
  d(ACC.proxy, 'hill', 'DEF 14A', '2026-04-02', [], 1, 'exhc-def14a-2026.htm', 'DEF 14A', `proxy statement. ${PERSON}, chief credit officer, is a named executive officer.`),
  d(ACC.loanSale, 'natl', '10-Q', '2026-11-05', [], 1, 'exnh-10q-q3.htm', '10-Q', 'we completed a loan sale of commercial real estate loans during the quarter'),
  d(ACC.acquisition, 'natl', '8-K', '2026-11-12', ['2.01', '9.01'], '1', 'exnh-8k-close.htm', '8-K', 'completion of acquisition or disposition of assets'),
  d(ACC.otherEvent, 'natl', '8-K', '2026-11-12', ['8.01'], '1', 'exnh-8k-other.htm', '8-K', 'other events'),
  d(ACC.desertImpairment, 'desert', '8-K', '2026-11-09', ['2.06'], '1', 'exdb-8k-impair.htm', '8-K', 'material impairments'),
  d(ACC.desertRepositioning, 'desert', '8-K', '2026-11-09', ['7.01', '9.01'], '1', 'exdb-8k-reg-fd.htm', '8-K', 'regulation fd disclosure'),
  d(ACC.desertRepositioning, 'desert', '8-K', '2026-11-09', ['7.01', '9.01'], '2', 'exdb-ex991.htm', 'EX-99.1', 'a balance sheet repositioning of the securities portfolio'),
  d(ACC.grocer, 'grocer', '8-K', '2026-11-09', ['7.01'], '1', 'exgr-8k.htm', '8-K', 'a balance sheet repositioning of our store leases'),
  d(ACC.oldImpairment, 'hill', '8-K', '2026-03-02', ['2.06', '9.01'], '1', 'exhc-8k-20260302.htm', '8-K', 'material impairments'),
  d(ACC.hill10q, 'hill', '10-Q', '2026-11-04', [], 1, 'exhc-10q-q3.htm', '10-Q', 'quarterly report'),
  d(ACC.trust10k, 'trust', '10-K', '2026-03-01', [], 1, 'exhct-10k.htm', '10-K', 'annual report of the trust'),
  d(ACC.natl10k, 'natl', '10-K', '2026-02-27', [], 1, 'exnh-10k.htm', '10-K', 'annual report'),
];

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const SHARDS = { total: 50, successful: 50, skipped: 0, failed: 0 };
const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// q as the real server reads it: quoted phrases (and bare words) are required; phrases joined by OR are alternatives.
export function parseQ(q) {
  const toks = String(q ?? '').match(/"[^"]*"|\S+/g) ?? [];
  const must = [], should = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'OR') continue;
    const p = toks[i].replace(/^"|"$/g, '');
    (toks[i + 1] === 'OR' || toks[i - 1] === 'OR' ? should : must).push(p);
  }
  return { must, should };
}

export function fakeSearch({ docs = DOCS(), filers = FILERS, cache = false, ttlMs = 60000, clock = () => 0, fail500 = 0, errorFor = null, dropField = null, leakText = false } = {}) {
  const calls = [];
  const cached = new Map();
  let failures = fail500;
  const list = (s, k) => (s.get(k) ? s.get(k).split(',').map((x) => x.trim()).filter(Boolean) : []);

  const answer = (s) => {
    const { must, should } = parseQ(s.get('q'));
    const hasQ = !!s.get('q');
    const forms = list(s, 'forms'), ciks = list(s, 'ciks'), states = list(s, 'locationCodes'), sics = [...list(s, 'sics'), ...list(s, 'sic')], items = list(s, 'items');
    const stateField = s.get('locationType') === 'incorporated' ? 'inc_states' : 'biz_states';
    const startdt = s.get('startdt'), enddt = s.get('enddt'), from = Number(s.get('from') ?? 0);
    if (from + 100 > 10000) return { errorType: 'ResponseError', errorMessage: `search_phase_execution_exception: [illegal_argument_exception] Reason: Result window is too large, from + size must be less than or equal to: [10000] but was [${from + 100}].` };
    const filter = [
      ...(forms.length ? [{ terms: { root_forms: forms } }] : []), ...(ciks.length ? [{ terms: { ciks } }] : []), ...(sics.length ? [{ terms: { sics } }] : []),
      ...(states.length ? [{ terms: { [stateField]: states } }] : []), ...(items.length ? [{ terms: { items } }] : []),
      ...(hasQ ? [] : [{ term: { sequence: { value: 1 } } }]), ...(startdt || enddt ? [{ range: { file_date: { gte: startdt, lte: enddt } } }] : []),
    ];
    const matching = docs.filter((x) => {
      const f = filers[x.filer];
      const text = x.text.toLowerCase();
      if (!must.every((p) => text.includes(p.toLowerCase()))) return false;
      if (should.length && !should.some((p) => text.includes(p.toLowerCase()))) return false;
      if (!hasQ && String(x.seq) !== '1') return false;
      if (forms.length && !forms.includes(x.root)) return false;
      if (ciks.length && !ciks.includes(f.cik)) return false;   // exact: an unpadded CIK matches nothing
      if (sics.length && !sics.includes(f.sic)) return false;
      if (states.length && !(stateField === 'biz_states' ? states.includes(f.state) : false)) return false;
      if (items.length && !x.items.some((i) => items.includes(i))) return false;
      if ((startdt && x.date < startdt) || (enddt && x.date > enddt)) return false;
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name < b.name ? -1 : 1));
    const hits = matching.slice(from, from + 100).map((x, i) => {
      const f = filers[x.filer];
      const src = {
        ciks: [f.cik], period_ending: x.date, file_num: ['001-99999'], display_names: [f.display], xsl: null, sequence: x.seq, root_forms: [x.root], file_date: x.date,
        biz_states: [f.state], sics: [f.sic], form: x.form, adsh: x.adsh, film_num: ['269999999'], biz_locations: [f.place], file_type: x.fileType, ma_i_individual: null,
        file_description: x.fileType, inc_states: ['DE'], items: x.items,
        ...(leakText ? { doc_text: x.text, highlight: [x.text.slice(0, 40)] } : {}),
      };
      if (dropField) delete src[dropField];
      return { _index: 'edgar_file', _id: `${x.adsh}:${x.name}`, _score: 10 - i / 100, _source: src };
    });
    const bucket = (vals) => Object.entries(vals.reduce((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {})).map(([key, doc_count]) => ({ key, doc_count }));
    const agg = (vals) => ({ doc_count_error_upper_bound: 0, sum_other_doc_count: 0, buckets: bucket(vals) });
    return {
      took: 12, timed_out: false, _shards: SHARDS,
      hits: { total: { value: matching.length, relation: 'eq' }, max_score: hits.length ? 10 : null, hits },
      aggregations: { entity_filter: agg(matching.map((x) => filers[x.filer].display)), sic_filter: agg(matching.map((x) => filers[x.filer].sic)), biz_states_filter: agg(matching.map((x) => filers[x.filer].state)), form_filter: agg(matching.map((x) => x.root)) },
      query: {
        _source: { exclude: ['doc_text'] },
        query: { bool: { must: must.map((p) => ({ match_phrase: { doc_text: p } })), must_not: [], should: should.map((p) => ({ match_phrase: { doc_text: p } })), filter } },
        from, size: 100,
        aggregations: { form_filter: { terms: { field: 'root_forms', size: 30 } }, entity_filter: { terms: { field: 'display_names.raw', size: 30 } }, sic_filter: { terms: { field: 'sics', size: 30 } }, biz_states_filter: { terms: { field: 'biz_states', size: 30 } } },
      },
    };
  };

  const entityAnswer = (text) => {
    const t = String(text).trim();
    const words = tokens(t);
    const unpadded = (c) => c.replace(/^0+/, '');
    const found = Object.values(filers).filter((f) => (/^\d+$/.test(t) && unpadded(f.cik) === unpadded(t)) || (words.length && !/^\d+$/.test(t) && words.every((w) => tokens(f.entity).includes(w))));
    return {
      took: 3, timed_out: false, _shards: SHARDS,
      hits: { total: { value: found.length, relation: 'eq' }, max_score: found.length ? 5 : null, hits: found.slice(0, 10).map((f, i) => ({ _index: 'edgar_entity_test', _id: unpadded(f.cik), _score: 5 - i, _source: { entity: f.entity, entity_words: f.entity.toLowerCase(), tickers: f.tickers, rank: i } })) },
      query: { query: { bool: { should: [{ match: { entity: { query: t, operator: 'and' } } }], must: [{ bool: { should: [{ match: { entity: { query: t, operator: 'and' } } }, { match: { _id: { query: t } } }] } }] } }, from: 0, size: 10 },
    };
  };

  // The CDN's key: every parameter but items and sics, in any order (seen 2026-11-13).
  const cacheKey = (s) => [...s.entries()].filter(([k]) => !['items', 'sics', 'sic'].includes(k)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url, ua: init.headers?.['user-agent'], params: Object.fromEntries(u.searchParams) });
    if (`${u.origin}${u.pathname}` !== URL_EFTS) return new Response('not found', { status: 404 });
    if (failures > 0) { failures--; return json(500, { message: 'Internal server error' }); }
    const s = u.searchParams;
    if (s.has('keysTyped')) return json(200, entityAnswer(s.get('keysTyped')));
    if (errorFor?.(Object.fromEntries(s))) return json(200, { errorType: 'ResponseError', errorMessage: 'search_phase_execution_exception: [query_shard_exception] Reason: failed to create query', trace: ['ResponseError: search_phase_execution_exception'] });
    if (cache) {
      const k = cacheKey(s), c = cached.get(k);
      if (c && clock() - c.at < ttlMs) return json(200, c.body);
      const body = answer(s);
      if (!body.errorType) cached.set(k, { at: clock(), body });
      return json(200, body);
    }
    return json(200, answer(s));
  };
  return { fetchImpl, calls };
}

// FDIC /institutions rows with the holding-company fields the suggestions read, added to the shared FDIC fake's tables.
// Bank 103 is a sibling of 101: the same holding company (RSSD 9100101).
export function withHoldingCompanies(tables) {
  const hcs = {
    101: { NAMEHCR: 'EXAMPLE HILL COUNTRY BANCSHARES, INC.', RSSDHCR: '9100101', FED_RSSD: '9200101', CITYHCR: 'EXAMPLEVILLE', STALPHCR: 'TX' },
    102: { NAMEHCR: 'EXAMPLE NATIONAL HOLDINGS CORP', RSSDHCR: '9100102', FED_RSSD: '9200102', CITYHCR: 'SAMPLE FALLS', STALPHCR: 'SD' },
    103: { NAMEHCR: 'EXAMPLE HILL COUNTRY BANCSHARES, INC.', RSSDHCR: '9100101', FED_RSSD: '9200103', CITYHCR: 'EXAMPLEVILLE', STALPHCR: 'TX' },
  };
  const blank = { NAMEHCR: '', RSSDHCR: '', FED_RSSD: '9200999', CITYHCR: '', STALPHCR: '' };
  tables.locations.push({ CERT: '103', CBSA_NO: '19740', CBSA: 'Denver-Aurora-Lakewood, CO', COUNTY: 'Denver', STCNTY: '08031', STALP: 'CO', MAINOFF: 1 });
  // An open bank, shaped like the FDIC fake's own: ENDEFYMD 12/31/9999 and no CHANGEC1 (the failure check reads them).
  tables.institutions.push({ CERT: 103, NAME: 'Example Front Range Bank', CITY: 'Denver', STALP: 'CO', ASSET: 700000, WEBADDR: 'www.example3.test', ACTIVE: 1, INACTIVE: 0, ENDEFYMD: '12/31/9999', STCNTY: '08031' });
  for (const r of tables.institutions) Object.assign(r, hcs[r.CERT] ?? blank);
  return tables;
}
