<script setup>
defineProps({ documents: { type: Array, default: () => [] } });
const labels = {
    pending: 'รอตรวจสอบ', packing: 'กำลังจัดสินค้า', payment: 'รอรับชำระ / กำลังนำส่ง',
    success: 'สำเร็จ', cancel: 'ยกเลิก'
};
const money = value => Number(value || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
</script>

<template>
    <section v-if="documents.length" class="document-flow">
        <h3>เอกสารที่ออกจากคำขอนี้</h3>
        <div v-for="qt in documents" :key="qt.qt_doc_no" class="document-flow__qt">
            <div class="document-flow__head"><strong>QT {{ qt.qt_doc_no }}</strong><span>{{ labels[qt.status] || qt.status }} · ฿{{ money(qt.total_amount) }}</span></div>
            <p v-if="!qt.so_documents?.length" class="document-flow__muted">ยังไม่มีใบสั่งขาย</p>
            <div v-for="so in qt.so_documents || []" :key="so.so_doc_no" class="document-flow__so">
                <div class="document-flow__head"><strong>SO {{ so.so_doc_no }}</strong><span>{{ labels[so.status] || so.status }}</span></div>
                <p v-if="!so.invoices?.length" class="document-flow__muted">ยังไม่มีใบกำกับ</p>
                <div v-for="invoice in so.invoices || []" :key="invoice.inv_doc_no" class="document-flow__invoice">
                    <div class="document-flow__head"><strong>INV {{ invoice.inv_doc_no }}</strong><span>{{ labels[invoice.status] || invoice.status }}</span></div>
                    <div class="document-flow__money">ยอดบิล ฿{{ money(invoice.total_amount) }} · รับชำระ ฿{{ money(invoice.paid_amount) }} · คงค้าง ฿{{ money(invoice.balance) }}</div>
                    <div v-for="(receipt, index) in invoice.receipts || []" :key="`${receipt.doc_no}-${index}`" class="document-flow__receipt">รับชำระ {{ receipt.doc_no }} · ฿{{ money(receipt.amount) }}</div>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.document-flow { margin: 1rem 0; padding: 1rem; border: 1px solid #dce8e1; border-radius: 12px; background: #fff; }
.document-flow h3 { font-size: 1rem; font-weight: 650; margin: 0 0 .75rem; }
.document-flow__qt { padding: .75rem; margin-top: .65rem; border: 1px solid #cde3d6; border-radius: 9px; background: #f6fbf7; }
.document-flow__head { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .35rem 1rem; }
.document-flow__head span { color: #396852; font-size: .875rem; }
.document-flow__so { margin: .65rem 0 0 .65rem; padding: .55rem .7rem; border-left: 3px solid #63a77e; background: white; }
.document-flow__invoice { margin: .55rem 0 0 .65rem; padding: .5rem .7rem; border-left: 3px solid #edaa59; background: #fffaf4; }
.document-flow__money, .document-flow__receipt, .document-flow__muted { font-size: .825rem; margin: .25rem 0 0; }
.document-flow__muted { color: #728477; }
.document-flow__receipt { color: #28714a; }
</style>
