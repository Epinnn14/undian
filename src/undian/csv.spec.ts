import { toCsv } from './csv';
import { ticketCode } from './undian.service';

describe('toCsv', () => {
  it('quotes only when needed and uses CRLF', () => {
    expect(toCsv(['a', 'b'], [[1, 'plain']])).toBe('a,b\r\n1,plain\r\n');
    expect(toCsv(['x'], [['Kipas, besar'], ['kata "hoki"'], ['dua\nbaris']])).toBe(
      'x\r\n"Kipas, besar"\r\n"kata ""hoki"""\r\n"dua\nbaris"\r\n',
    );
  });

  it('writes empty cells for null and undefined', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, 0]])).toBe('a,b,c\r\n,,0\r\n');
  });
});

describe('ticketCode', () => {
  it('zero-pads to four digits and keeps growing after that', () => {
    expect(ticketCode('T', 7)).toBe('T0007');
    expect(ticketCode('DP', 123)).toBe('DP0123');
    expect(ticketCode('T', 12345)).toBe('T12345');
  });
});
