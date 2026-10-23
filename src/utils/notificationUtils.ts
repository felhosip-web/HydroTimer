export function getNotificationBodyForConfig(
  config: { title: string; presetId?: string; alertDurationSeconds?: number; intakeMlPerAlert?: number; dailyGoalMl?: number; message?: string },
  intakeMl?: number,
  dailyGoalMl?: number
): string {
  // If the user configured an explicit custom notification message, preserve and use it
  if (config.message && config.message.trim().length > 0) {
    return config.message.trim();
  }

  const effectiveIntake = intakeMl ?? config.intakeMlPerAlert ?? 0;
  const effectiveGoal = dailyGoalMl ?? config.dailyGoalMl ?? 2500;
  const titleLower = (config.title || '').toLowerCase();
  const presetId = config.presetId || '';

  // Water intake reminder
  if (effectiveIntake > 0 || presetId === 'water' || presetId === 'event_water' || titleLower.includes('víz')) {
    if (effectiveIntake > 0 && effectiveGoal > 0) {
      return `Ideje inni: ${effectiveIntake} ml víz. Napi cél: ${effectiveGoal} ml.`;
    }
  }

  // Event-specific non-water reminders
  if (presetId === 'event_stretch' || titleLower.includes('nyújtás') || titleLower.includes('felállás')) {
    return 'Állj fel, nyújtsd át az izmaidat és mozgass meg minden ízületet!';
  }
  if (presetId === 'event_eye' || titleLower.includes('szemtorna') || titleLower.includes('20-20-20')) {
    return 'Nézz 20 láb (6 méter) távolságba legalább 20 másodpercig!';
  }
  if (presetId === 'event_medicine' || titleLower.includes('gyógyszer') || titleLower.includes('vitamin')) {
    return 'Ideje bevenni az esedékes gyógyszert vagy vitamint!';
  }
  if (presetId === 'event_walk' || titleLower.includes('séta') || titleLower.includes('levegő')) {
    return 'Tarts egy rövid sétát a friss levegőn!';
  }
  if (presetId === 'event_focus' || titleLower.includes('fókusz') || titleLower.includes('légzés')) {
    return 'Tarts egy rövid szünetet, vegyél mély levegőt és fókuszálj!';
  }

  return `Emlékeztető: ${config.title}. (${Math.max(5, config.alertDurationSeconds || 15)} mp áll rendelkezésre!)`;
}
