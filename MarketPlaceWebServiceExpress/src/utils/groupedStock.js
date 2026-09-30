const { ERP_CODE_SQL_PATTERN, ERP_CODE_SQL_PATTERN_OPTIONAL, filterErpCodeList } = require('./erpCodeGuard');

// inputSql is a trusted SQL fragment producing item_code, wh_code. Values must
// remain parameters. The CTE keeps the display code and physical code separate.
function groupedStockCtes(inputSql, output = 'normal_stock') {
  if (!/^[a-z_]+$/.test(output)) throw new Error('Invalid stock CTE identifier');
  return `
    gs_input AS (SELECT DISTINCT item_code, wh_code FROM (${inputSql}) gs_source),
    gs_map AS (
      SELECT DISTINCT i.item_code, i.wh_code, COALESCE(v.code,i.item_code) AS physical_code
      FROM gs_input i LEFT JOIN ic_inventory v ON v.name_eng_2=i.item_code
      WHERE i.item_code ~ '${ERP_CODE_SQL_PATTERN}'
        AND i.wh_code ~ '${ERP_CODE_SQL_PATTERN_OPTIONAL}'
    ),
    gs_codes AS (
      SELECT wh_code, string_agg(DISTINCT physical_code, ',') AS codes FROM gs_map
      WHERE physical_code ~ '${ERP_CODE_SQL_PATTERN}' AND length(physical_code)<=50
      GROUP BY wh_code
    ),
    gs_physical AS (
      SELECT c.wh_code,s.ic_code,SUM(s.balance_qty) AS balance_qty
      FROM gs_codes c CROSS JOIN LATERAL sml_ic_function_stock_balance_warehouse_location(current_date,c.codes,c.wh_code,'') s
      GROUP BY c.wh_code,s.ic_code
    ),
    ${output} AS (
      SELECT m.item_code AS ic_code,m.wh_code,COALESCE(SUM(s.balance_qty),0) AS balance_qty
      FROM gs_map m LEFT JOIN gs_physical s ON s.ic_code=m.physical_code AND s.wh_code=m.wh_code
      GROUP BY m.item_code,m.wh_code
    )`;
}

// Staff must see physical stock, never recursively aggregate the display group.
async function readPhysicalStock(client, codes) {
  const safeCodes = [...new Set(filterErpCodeList(codes))];
  if (!safeCodes.length) return [];
  const result = await client.query(
    `SELECT s.ic_code,s.balance_qty,
      COALESCE(to_jsonb(s)->>'ic_warehouse',to_jsonb(s)->>'wh_code',to_jsonb(s)->>'warehouse') AS wh_code,
      COALESCE(to_jsonb(s)->>'ic_shelf',to_jsonb(s)->>'shelf_code',to_jsonb(s)->>'location') AS shelf_code,
      COALESCE(to_jsonb(s)->>'ic_unit_code','') AS stock_unit_code
     FROM sml_ic_function_stock_balance_warehouse_location(current_date,$1,'','') s`, [safeCodes.join(',')]);
  if (result.rows.some(row => row.wh_code === null || row.shelf_code === null)) throw new Error('ERP stock result does not expose recognized warehouse/location columns');
  return result.rows;
}

module.exports = { groupedStockCtes, readPhysicalStock };
