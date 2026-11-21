export type EdgeWidth = (weight: number | undefined) => number;

export function edgeWidthScale(edges: readonly { weight?: number | undefined }[]): EdgeWidth {
  const weights = edges.flatMap((edge) => (edge.weight === undefined ? [] : [edge.weight]));
  if (weights.length === 0) return () => 1.5;
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  if (max === min) return () => 1.5;
  return (weight) => (weight === undefined ? 1.5 : 1.5 + ((weight - min) / (max - min)) * 4.5);
}
