const BODY_PART_LABELS: Record<string, string> = {
  back: 'Espalda', cardio: 'Cardio', chest: 'Pecho', 'lower arms': 'Antebrazos',
  'lower legs': 'Pantorrillas', neck: 'Cuello', shoulders: 'Hombros',
  'upper arms': 'Brazos', 'upper legs': 'Piernas', waist: 'Abdomen',
};

const EQUIPMENT_LABELS: Record<string, string> = {
  'body weight': 'Peso corporal', dumbbell: 'Mancuerna', barbell: 'Barra',
  cable: 'Polea', band: 'Banda', kettlebell: 'Kettlebell',
};

export const bodyPartLabel = (value: string) => BODY_PART_LABELS[value] ?? value;
export const equipmentLabel = (value: string) => EQUIPMENT_LABELS[value] ?? value;
