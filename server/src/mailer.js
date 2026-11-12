import nodemailer from 'nodemailer';

export function createMailer(config, log) {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });

  async function send(to, subject, text) {
    try {
      await transport.sendMail({ from: config.smtp.from, to, subject, text });
    } catch (error) {
      // Never reveal delivery problems to the client (prevents account
      // enumeration); keep them visible to operators.
      log.error({ err: error.message, subject }, 'mail delivery failed');
    }
  }

  return {
    sendAccountExists(to, loginLink, recoveryLink) {
      return send(
        to,
        'Intento de registro en DadoFit',
        `Hola,\n\nAlguien intentó crear una cuenta de DadoFit con este correo, pero ya tienes una.\n\nSi fuiste tú, inicia sesión: ${loginLink}\nSi olvidaste tu contraseña, recupérala: ${recoveryLink}\n\nSi no fuiste tú, ignora este mensaje: tu cuenta no ha cambiado.\n`,
      );
    },
    sendEmailConfirmation(to, link) {
      return send(
        to,
        'Confirma tu correo en DadoFit',
        `Hola,\n\nConfirma tu correo para activar tu cuenta de DadoFit:\n${link}\n\nEl enlace caduca en 24 horas. Si no creaste esta cuenta, ignora este mensaje.\n`,
      );
    },
    sendPasswordRecovery(to, link) {
      return send(
        to,
        'Recupera tu contraseña de DadoFit',
        `Hola,\n\nUsa este enlace para crear una nueva contraseña:\n${link}\n\nEl enlace caduca en 30 minutos y solo se puede usar una vez. Si no lo pediste, ignora este mensaje.\n`,
      );
    },
  };
}
