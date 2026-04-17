const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRawAttendeeCompany,
  getRawAttendeeName,
  looksLikeAddress,
  looksLikePlaceholderCompany
} = require('../lib/attendee-loader');

test('getRawAttendeeName prefers a direct Name column', () => {
  assert.equal(getRawAttendeeName({ Name: 'Jane Doe', 'First Name': 'Ignored', 'Last Name': 'Value' }), 'Jane Doe');
});

test('getRawAttendeeName falls back to first and last name columns', () => {
  assert.equal(getRawAttendeeName({ 'First Name': 'Jane', 'Last Name': 'Doe' }), 'Jane Doe');
});

test('getRawAttendeeName trims empty first and last name values', () => {
  assert.equal(getRawAttendeeName({ 'First Name': '  Jane ', 'Last Name': '' }), 'Jane');
});

test('getRawAttendeeCompany prefers the Company column', () => {
  assert.equal(getRawAttendeeCompany({ Company: 'Acme', Title: 'Manager' }), 'Acme');
});

test('getRawAttendeeCompany falls back to Title when Company is blank', () => {
  assert.equal(getRawAttendeeCompany({ Company: '', Title: 'Acme' }), 'Acme');
});

test('getRawAttendeeCompany falls back to Title when Company is a placeholder', () => {
  assert.equal(getRawAttendeeCompany({ Company: '000', Title: 'Avison Young' }), 'Avison Young');
});

test('getRawAttendeeCompany falls back to Title when Company looks like an address', () => {
  assert.equal(getRawAttendeeCompany({ Company: '110 N Carpenter St', Title: "McDonald's Corporation" }), "McDonald's Corporation");
});

test('address and placeholder helpers detect noisy company cells', () => {
  assert.equal(looksLikePlaceholderCompany('0'), true);
  assert.equal(looksLikeAddress('110 N Carpenter St'), true);
});
