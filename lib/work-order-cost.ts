type CostItem = {
  material?: CostItem[];
  group_flag?: boolean;
  label?: string;
  volume?: number | string | null;
  volume_cost_final?: number | string | null;
};

// Null means detail has not arrived; zero is a valid calculated total.
export function totalServiceCost(items: CostItem[] | null | undefined): number | null {
  if (!Array.isArray(items)) return null;
  return items.reduce((sum, item) => {
    if (item.material?.length) return sum + (totalServiceCost(item.material) ?? 0);
    if (item.group_flag || item.label?.toLowerCase() === 'grup') return sum;
    const price = Number(item.volume_cost_final ?? 0);
    const volume = Number(item.volume ?? 1);
    return sum + (Number.isFinite(price) && Number.isFinite(volume) ? price * volume : 0);
  }, 0);
}
