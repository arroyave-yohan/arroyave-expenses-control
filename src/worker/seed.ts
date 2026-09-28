import type { Categoria } from '../shared/types';

export const SEED_CATEGORIAS: Categoria[] = [
  { id: 'vivienda', nombre: 'Vivienda', hue: 205, orden: 0 },
  { id: 'ninos', nombre: 'Niños', hue: 330, orden: 1 },
  { id: 'servicios-publicos', nombre: 'Servicios públicos', hue: 40, orden: 2 },
  { id: 'plataformas', nombre: 'Plataformas', hue: 265, orden: 3 },
  { id: 'ahorro', nombre: 'Ahorro', hue: 150, orden: 4 },
  { id: 'transporte', nombre: 'Transporte', hue: 20, orden: 5 },
  { id: 'alimentacion', nombre: 'Alimentación', hue: 95, orden: 6 },
  { id: 'otros', nombre: 'Otros', hue: 0, orden: 7 },
];
