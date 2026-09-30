const express = require('express');
const request = require('supertest');
jest.mock('../../src/db', () => ({ query: jest.fn(), withTransaction: jest.fn() }));
jest.mock('../../src/auth/pendingOrderAuth', () => ({
  pendingIdentity: (req, res, next) => { req.auth = { isEmployee: true, userCode: 'EMP' }; next(); },
  pendingAdmin: (req, res, next) => next(),
}));
jest.mock('../../src/utils/pendingOrder', () => ({ fail: (message, statusCode = 409) => Object.assign(new Error(message), { statusCode }) }));
jest.mock('../../src/utils/pendingAllocations', () => ({ loadOptions: jest.fn() }));
const { query } = require('../../src/db');
const app = express();
app.use(require('../../src/routes/pendingOrders')());
beforeEach(() => { query.mockReset(); query.mockResolvedValueOnce({ rows: [{ total: 45 }] }).mockResolvedValueOnce({ rows: [] }); });
describe('pending queue sort', () => {
  it.each([['oldest', 'ASC'], ['newest', 'DESC']])('sorts the full queue %s before pagination with stable tie-breaker', async (sort, direction) => {
    const response = await request(app).get('/admin/pending-orders').query({ sort, page: 2, search: 'ABC' });
    expect(response.status).toBe(200);
    const [sql, values] = query.mock.calls[1];
    expect(sql).toContain(`ORDER BY p.created_at ${direction},p.doc_no ${direction} LIMIT $5 OFFSET $6`);
    expect(values.slice(-2)).toEqual([20, 20]);
    expect(response.body.total).toBe(45);
  });
  it('keeps newest as the API default', async () => {
    expect((await request(app).get('/admin/pending-orders')).status).toBe(200);
    expect(query.mock.calls[1][0]).toContain('p.created_at DESC,p.doc_no DESC');
  });
  it('rejects unsupported sort input without interpolating it in SQL', async () => {
    const response = await request(app).get('/admin/pending-orders').query({ sort: 'ASC; DROP TABLE ic_trans' });
    expect(response.status).toBe(400); expect(query).not.toHaveBeenCalled();
  });
  it('leaves customer history ordering unchanged', async () => {
    expect((await request(app).get('/pending-orders').query({ sort: 'oldest' })).status).toBe(200);
    expect(query.mock.calls[1][0]).toContain('p.created_at DESC,p.doc_no DESC');
  });
});
