import { describe, it, expect } from 'vitest';
import { parseCsv, parseMonto, normalize, parseSheetCsv, toMonthDoc } from '../../scripts/import-csv/parse';
import { computeTotals } from '../../src/shared/totals';
import { SEED_CATEGORIAS } from '../../src/worker/seed';

// Fixture con datos simulados que reproduce la forma del sheet real (36 filas,
// 16 pagadas, 5 sin monto, 2 sin categoría). Totales recalculados abajo.
const JULIO_CSV = [
  'Torre de control Ingresos / Egresos,,,,,,,,,',
  'Ingresos,"$12.400.000",Egresos,"$11.617.000",Diferencia,"$783.000",,,,',
  'Pagado,"$8.754.000",Pendiente,"$2.863.000",,,,,,',
  'Fecha,Concepto,Monto,Categoria,Recurrente,Separado?,Pagado?,Bolsillo/Medio de pago,Link de pago,Ref de pago',
  ',Arriendo,"$1.200.000",Vivienda,TRUE,FALSE,TRUE,Nu: Arriendo,Nequi: 300 000 0000,',
  ',Arriendo oficina,"$1.100.000",Vivienda,TRUE,FALSE,TRUE,Nu: Arriendo,,',
  ',Colegio,"$850.000",Niños,TRUE,FALSE,TRUE,Nu: Gastos Niños,https://colegio.example.com/,',
  ',Terapias,,Niños,TRUE,FALSE,FALSE,,,',
  ',Energia,"$150.000",Servicios publicos,TRUE,FALSE,FALSE,PSE,Electrica — cuenta 445566,',
  ',Servicios oficina,"$200.000",Servicios publicos,TRUE,FALSE,TRUE,,,',
  ',Tarjeta de Credito NU,"$1.000.000",Otros,TRUE,FALSE,FALSE,,,',
  ',Agua,"$120.000",Servicios publicos,TRUE,FALSE,FALSE,PSE,Acueducto — cuenta 123456,',
  ',Gas,"$90.000",Servicios publicos,TRUE,FALSE,FALSE,PSE,Gas — contrato 654321,',
  ',Internet hogar,"$54.000",Servicios publicos,TRUE,FALSE,TRUE,Online,https://isp.example.com/pagar,',
  ',Celular linea 1,"$50.000",Servicios publicos,TRUE,FALSE,TRUE,Online,https://movil.example.com/pagar,',
  ',Celular linea 2,"$35.000",Servicios publicos,TRUE,FALSE,FALSE,Online,https://movil.example.com/pagar,',
  ',Telefonia fija,"$99.000",Servicios publicos,TRUE,FALSE,FALSE,PSE,,',
  ',Netflix,"$40.000",Plataformas,TRUE,FALSE,FALSE,Billetera digital,,',
  ',Google One,"$45.000",Plataformas,TRUE,FALSE,FALSE,Billetera digital,,',
  ',Youtube,"$42.000",Plataformas,TRUE,FALSE,FALSE,Billetera digital,,',
  ',Disney,"$45.000",Plataformas,TRUE,FALSE,FALSE,Billetera digital,,',
  ',Ropa niños,"$300.000",Niños,TRUE,FALSE,TRUE,Nu: Ropa niños,,',
  ',Odontologia,"$100.000",Niños,TRUE,FALSE,TRUE,Nu: Gastos Niños,,',
  ',Ahorro carro,"$600.000",Ahorro,TRUE,FALSE,TRUE,Nu: Carro,,',
  ',Gasolina,"$400.000",Transporte,TRUE,FALSE,TRUE,Nu: Gasolina,,',
  ',Ahorro navidad,"$700.000",Ahorro,TRUE,FALSE,TRUE,Cuenta ahorros,,',
  ',Cuota celulares,"$400.000",,FALSE,FALSE,TRUE,,,',
  ',Jardin infantil,"$300.000",,FALSE,FALSE,TRUE,,,',
  ',Mensualidad hogar,"$1.500.000",Otros,TRUE,FALSE,TRUE,Cuenta ahorros,,',
  ',Diarios,"$700.000",Alimentación,TRUE,FALSE,TRUE,Cuenta ahorros,,',
  ',Carne,"$300.000",Alimentación,TRUE,FALSE,TRUE,Cuenta ahorros,,',
  ',Mercado supermercado,,Alimentación,TRUE,FALSE,FALSE,Datafono,,',
  ',Mercado descuento,,Alimentación,TRUE,FALSE,FALSE,Datafono,,',
  ',Mercado barrio,,Alimentación,TRUE,FALSE,FALSE,Datafono,,',
  ',Mercado mayorista,,Alimentación,TRUE,FALSE,FALSE,Datafono,,',
  ',Vigilancia,"$60.000",Vivienda,TRUE,FALSE,FALSE,Efectivo / Nequi,,',
  ',Educacion niños,"$370.000",Ahorro,TRUE,FALSE,FALSE,Broker,,',
  ',Ahorro pension,"$370.000",Ahorro,TRUE,FALSE,FALSE,Broker,,',
  ',Dolares,"$375.000",Ahorro,TRUE,FALSE,FALSE,Billetera digital,,',
  ',Donacion,"$22.000",Otros,TRUE,FALSE,FALSE,PSE,https://donaciones.example.com/,',
  ',,,,,,,,,',
].join('\r\n');

describe('parseCsv', () => {
  it('maneja comillas, comas internas y comillas escapadas', () => {
    expect(parseCsv('a,"b, c","d ""e""",\r\n1,2,3,4')).toEqual([['a', 'b, c', 'd "e"', ''], ['1', '2', '3', '4']]);
  });
  it('maneja un campo entre comillas que contiene un salto de línea', () => {
    expect(parseCsv('a,"x\ny",b')).toEqual([['a', 'x\ny', 'b']]);
  });
});

describe('parseMonto y normalize', () => {
  it('convierte formato colombiano', () => {
    expect(parseMonto('$1.200.000')).toBe(1200000);
    expect(parseMonto(' $23.500 ')).toBe(23500);
    expect(parseMonto('')).toBeNull();
  });
  it('normaliza tildes, mayúsculas y espacios', () => {
    expect(normalize('  Servicios  Públicos ')).toBe('servicios publicos');
    expect(normalize('Alimentación')).toBe('alimentacion');
  });
});

describe('parseSheetCsv + toMonthDoc con Julio 2026', () => {
  it('lee ingresos, 36 filas y reproduce los totales del sheet', () => {
    const parsed = parseSheetCsv(JULIO_CSV);
    expect(parsed.ingresos).toBe(12400000);
    expect(parsed.rows).toHaveLength(36);

    const { doc, unmatched } = toMonthDoc(parsed, '2026-07', SEED_CATEGORIAS);
    expect(doc.month).toBe('2026-07');
    expect(doc.version).toBe(1);
    expect(doc.ingresos).toBe(12400000);
    expect(unmatched).toEqual([]);
    expect(doc.rows.filter((r) => r.categoriaId === null)).toHaveLength(2);
    expect(doc.rows.find((r) => r.concepto === 'Energia')?.categoriaId).toBe('servicios-publicos');
    expect(doc.rows.find((r) => r.concepto === 'Diarios')?.categoriaId).toBe('alimentacion');
    expect(doc.rows.filter((r) => r.estado === 'pagado')).toHaveLength(16);
    expect(doc.rows.every((r) => r.estado === 'pagado' || r.fechaPago === null)).toBe(true);
    expect(new Set(doc.rows.map((r) => r.id)).size).toBe(36);

    const t = computeTotals(doc);
    expect(t.egresos).toBe(11617000);
    expect(t.pagado).toBe(8754000);
    expect(t.pendiente).toBe(2863000);
    expect(t.sinMonto).toBe(5);
  });

  it('deriva estado separado y reporta categorías desconocidas', () => {
    const csv = ['Fecha,Concepto,Monto,Categoria,Recurrente,Separado?,Pagado?,Bolsillo/Medio de pago,Link de pago,Ref de pago',
      ',Perro,"$10.000",Mascotas,TRUE,TRUE,FALSE,,,'].join('\n');
    const { doc, unmatched } = toMonthDoc(parseSheetCsv(csv), '2026-01', SEED_CATEGORIAS, 500);
    expect(doc.ingresos).toBe(500);
    expect(doc.rows[0].estado).toBe('separado');
    expect(doc.rows[0].categoriaId).toBeNull();
    expect(unmatched).toEqual(['Mascotas']);
  });

  it('acepta pestañas sin la columna Separado? y con fecha en español para filas pagadas', () => {
    const csv = ['Fecha,Concepto,Monto,Categoria,Recurrente,Pagado?,Bolsillo/Medio de pago,Link de pago,Ref de pago',
      '"jueves, 5 de febrero",Arriendo,"$1.200.000",Vivienda,TRUE,TRUE,Nu: Arriendo,,'].join('\n');
    const { doc } = toMonthDoc(parseSheetCsv(csv), '2026-02', SEED_CATEGORIAS, 0);
    expect(doc.rows[0].estado).toBe('pagado');
    expect(doc.rows[0].fechaPago).toBe('2026-02-05');
  });
});
