export const isTimelineBikeSelected = (bike, selections) =>
  selections[bike.gid] ?? bike.name.trim().toLowerCase() !== "rental bike";
