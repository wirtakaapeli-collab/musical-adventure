const ADMIN_USER = 'Olli';
const ADMIN_PIN = '011100';

function buildToken(username) {
  return Buffer.from(`${username}:${Date.now()}:asterdex-dashboard`).toString('base64url');
}

function verifyLogin(username, pin) {
  return username === ADMIN_USER && pin === ADMIN_PIN;
}

module.exports = {
  ADMIN_USER,
  ADMIN_PIN,
  buildToken,
  verifyLogin,
};
