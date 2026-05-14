function flattenInArguments(inArguments) {
  const output = {};
  if (!Array.isArray(inArguments)) return output;

  for (const item of inArguments) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      Object.assign(output, item);
    }
  }

  return output;
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function truncate(value, length) {
  const text = value === undefined || value === null ? '' : String(value);
  if (text.length <= length) return text;
  return text.slice(0, Math.max(0, length - 3)) + '...';
}

module.exports = {
  flattenInArguments,
  pickFirst,
  truncate
};
