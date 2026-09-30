// Explicitly opted-in demo inspection/fixtures; never reads the application's .env.
const { Client } = require('pg');
async function main() {
  if (process.env.SAMAI_DEMO_HOST !== 'nextstep.iszai.com' || process.env.SAMAI_DEMO_DATABASE !== 'demo') throw new Error('Explicit authorized demo target required');
  const db = new Client({ host: process.env.SAMAI_DEMO_HOST, port: Number(process.env.SAMAI_DEMO_PORT), database: process.env.SAMAI_DEMO_DATABASE,
    user: process.env.SAMAI_DEMO_USER, password: process.env.SAMAI_DEMO_PASSWORD, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  await db.connect();
  try {
    if (process.argv.includes('--summary')) {
      const products = await db.query("SELECT code,name_1,name_eng_2,unit_standard FROM ic_inventory WHERE code='SAMAI-TEST-001' OR name_eng_2='SAMAI-TEST-001' ORDER BY code");
      const settings = await db.query("SELECT setting_key,setting_value FROM marketplace_sales_setting WHERE setting_key='stock_display_percent'");
      const docs = await db.query("SELECT COUNT(*)::int AS count FROM ic_trans WHERE remark LIKE '%SAMAI rollback verification only%'");
      console.log(JSON.stringify({ products: products.rows, settings: settings.rows, retained_test_documents: docs.rows[0].count }));
      return;
    }
    const functions = await db.query("SELECT pg_get_function_result(oid) AS result, pg_get_function_arguments(oid) AS args FROM pg_proc WHERE proname='sml_ic_function_stock_balance_warehouse_location'");
    console.log('Stock function contract:', JSON.stringify(functions.rows));
    const fields = await db.query("SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1) AND (column_name IN ('roworder','code','name_eng_2','unit_standard','stand_value','divide_value','ratio','qty','doc_ref','last_status') OR is_nullable='NO') ORDER BY table_name,ordinal_position", [['ic_inventory','ic_inventory_detail','ic_unit_use','ic_trans','ic_trans_detail']]);
    console.log('Master/document fields:', JSON.stringify(fields.rows));
    const existing = await db.query("SELECT code,name_1,unit_standard,item_type,tax_type FROM ic_inventory WHERE code LIKE 'SAMAI-TEST-%' ORDER BY code");
    console.log('Existing test products:', JSON.stringify(existing.rows));
    const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'marketplace_%' OR table_name IN ('ic_inventory_price','ic_unit','ic_warehouse','ic_shelf')) ORDER BY table_name");
    console.log('Available supporting tables:', JSON.stringify(tables.rows));
    const candidates = await db.query(`SELECT i.code,i.name_1,i.name_eng_2,i.unit_standard,i.tax_type,i.balance_qty,i.item_pattern,
      u.stand_value,u.divide_value,u.ratio,d.start_sale_wh,d.start_sale_shelf
      FROM ic_inventory i JOIN ic_unit_use u ON u.ic_code=i.code AND u.code=i.unit_standard
      LEFT JOIN ic_inventory_detail d ON d.ic_code=i.code
      WHERE COALESCE(i.item_type,0)=0 AND COALESCE(i.name_eng_2,'')='' AND i.balance_qty>0
        AND u.stand_value=1 AND u.divide_value=1 AND u.ratio=1
      ORDER BY i.code LIMIT 12`);
    console.log('Compatible stock candidates:', JSON.stringify(candidates.rows));
    const columns = await db.query("SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('ic_inventory_price','ic_inventory_barcode') ORDER BY table_name,ordinal_position");
    console.log('Price/barcode columns:', JSON.stringify(columns.rows));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
