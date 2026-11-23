// Evita repetir try/catch en cada ruta: si la promesa falla, el error
// cae directo al errorHandler central de Express.
module.exports = function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
};
