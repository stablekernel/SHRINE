// catalogue.json v1 (spec 6).
import { arr, dict, int, literal, nullable, obj, oneOf, str, validate } from './validate.mjs';

const entry = obj({ entry_id: str, text: str, anchor: str, line: int }, { also_ids: arr(str) });
const page = { id: str, title: str, status: oneOf(['ratified', 'draft']), url: str };
const link = obj({ page_id: str, anchor: str });

export const catalogueSchema = obj({
  schema_version: literal(1),
  shrine: obj({ commit: str, site: str, files: dict(str) }),
  principles: arr(obj({ ...page, signals_of_violation: arr(entry, { min: 1 }) }), { min: 1 }),
  patterns: arr(obj({ ...page, anti_patterns: arr(entry, { min: 1 }) })),
  stack: arr(obj({ ...page, anti_patterns: arr(entry, { min: 1 }) })),
  anti_patterns: arr(
    obj({ entry_id: str, group: str, symptom: str, anti_pattern: str, fix_links: arr(link, { min: 1 }), anchor: str, line: int }),
  ),
  symptoms: arr(obj({ entry_id: str, symptom: str, links: arr(link), anchor: str, line: int })),
  glossary: arr(obj({ term: str, definition: str })),
  entries: dict(
    obj({
      entry_id: str,
      page_id: str,
      anchor: str,
      title: str,
      section: oneOf(['principle', 'pattern', 'stack', 'reference']),
      status: oneOf(['ratified', 'draft']),
      url: str,
      url_pinned: str,
      quote: str,
    }),
  ),
}, { unresolved: nullable(arr(str)) });

export const validateCatalogue = (c) => validate(catalogueSchema, c);
