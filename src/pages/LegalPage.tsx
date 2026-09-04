import { ArrowLeft, Cookie, Database, Dice5, FileText, HeartPulse, Scale, ShieldCheck, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';

export type LegalDocument = 'terms' | 'privacy' | 'cookies' | 'data' | 'community';

type Section = { title: string; paragraphs?: string[]; bullets?: string[] };
type DocumentContent = {
  eyebrow: string;
  title: string;
  summary: string;
  icon: typeof ShieldCheck;
  sections: Section[];
  notice?: string;
};

const DOCUMENTS: Record<LegalDocument, DocumentContent> = {
  terms: {
    eyebrow: 'MARCO DE USO',
    title: 'Términos y condiciones',
    summary: 'Reglas generales para usar DadoFit, participar en retos, gestionar workspaces y relacionarse con otros miembros, Gyms y Marcas.',
    icon: FileText,
    sections: [
      { title: '1. Alcance del servicio', paragraphs: ['DadoFit es una plataforma fitness gamificada que permite descubrir ejercicios, participar en retos, relacionarse con Gymbros, crear o integrar Squads y Organizaciones, y participar en activaciones patrocinadas.', 'El uso de la plataforma implica aceptar estas reglas y las políticas relacionadas publicadas en DadoFit.'] },
      { title: '2. Cuenta, identidad y workspaces', bullets: ['Cada persona debe usar una identidad propia y mantener sus credenciales protegidas.', 'Una misma identidad puede acceder a contextos personales, Gym u Organización y Marca cuando tenga permisos válidos.', 'Los permisos de Owner, Admin, Coach o Member corresponden únicamente al workspace en el que fueron otorgados y no convierten al usuario en administrador global de DadoFit.'] },
      { title: '3. Entrenamiento y salud', paragraphs: ['Los ejercicios, repeticiones, retos y contenidos de DadoFit tienen fines informativos, recreativos y de gamificación. No sustituyen una valoración médica, fisioterapéutica o de entrenamiento profesional.', 'Cada usuario debe considerar su condición física, utilizar técnica adecuada, detener la actividad ante dolor o malestar y buscar orientación profesional cuando corresponda.'] },
      { title: '4. Retos, evidencia y validación', bullets: ['Cuando un reto exige evidencia, la finalización queda sujeta a la revisión definida para ese reto.', 'Una evidencia puede ser aprobada o rechazada de acuerdo con las reglas de la campaña, Gym, Squad u oponente.', 'Algunas campañas patrocinadas pueden exigir doble validación por dos responsables distintos.', 'Completar o enviar un reto no garantiza automáticamente una recompensa cuando aplican límites, controles antifarming o reglas de elegibilidad.'] },
      { title: '5. DadoCoins, XP, Team Points y Sponsor Points', paragraphs: ['DadoCoins son puntos de fidelización internos y no constituyen dinero, depósito, título valor, criptoactivo ni saldo retirable. XP representa progresión; Team Points y Sponsor Points representan contribución competitiva dentro de sus respectivos contextos.', 'DadoFit puede aplicar límites, controles antifraude y reglas de elegibilidad para proteger la integridad de la economía de recompensas.'] },
      { title: '6. Marcas, patrocinios y publicidad', paragraphs: ['DadoFit puede mostrar campañas patrocinadas y espacios publicitarios identificados como publicidad o contenido patrocinado. La presencia de una Marca no implica recomendación médica ni garantía sobre productos o servicios de terceros.', 'Las Marcas y Organizaciones solo pueden operar dentro de los permisos asignados a su workspace y pueden estar sujetas a verificación, revisión o suspensión.'] },
      { title: '7. Conductas no permitidas', bullets: ['Manipular evidencias, identidades, recompensas, puntos o resultados.', 'Acosar, amenazar, suplantar o discriminar a otros usuarios.', 'Publicar contenido ilegal, engañoso, invasivo de la privacidad o que vulnere derechos de terceros.', 'Intentar evadir restricciones, controles antifarming, permisos, RLS, auditorías o mecanismos de seguridad.', 'Usar DadoFit para spam, fraude o explotación no autorizada de la comunidad.'] },
      { title: '8. Moderación y suspensión', paragraphs: ['DadoFit puede rechazar contenido, limitar funcionalidades, suspender o desactivar accesos cuando existan incumplimientos, riesgos de seguridad, fraude, abuso o requerimientos legales. Las acciones administrativas sensibles pueden quedar registradas en auditoría.'] },
      { title: '9. Propiedad intelectual', paragraphs: ['La interfaz, marca, software y elementos propios de DadoFit están protegidos por los derechos que correspondan. Los usuarios y organizaciones conservan los derechos que tengan sobre sus contenidos, sin perjuicio de los permisos necesarios para procesarlos y mostrarlos dentro de la funcionalidad solicitada.'] },
      { title: '10. Disponibilidad y cambios', paragraphs: ['La plataforma puede evolucionar, incorporar nuevas funcionalidades, modificar reglas operativas o realizar mantenimientos. Los cambios materiales en estos términos deberán reflejarse mediante una versión actualizada de este documento.'] },
      { title: '11. Contacto', paragraphs: ['Las solicitudes relacionadas con estos términos, soporte, privacidad o uso de la plataforma pueden enviarse desde el formulario oficial de contacto de DadoFit.'] },
    ],
  },
  privacy: {
    eyebrow: 'PROTECCIÓN DE INFORMACIÓN',
    title: 'Política de privacidad',
    summary: 'Qué información utiliza DadoFit, para qué se procesa y qué controles tiene la persona sobre sus datos.',
    icon: ShieldCheck,
    sections: [
      { title: '1. Información que puede procesar DadoFit', bullets: ['Datos de cuenta: nombre, correo, username, avatar y datos de autenticación administrados por el proveedor de identidad.', 'Datos de actividad: retos, estados, participaciones, Gymbros, Squads, Organizaciones, puntos, XP y recompensas.', 'Evidencias voluntariamente cargadas para validar retos, como fotografías o videos.', 'Información de workspaces y roles en Gyms, Organizaciones o Marcas.', 'Solicitudes enviadas por Contáctanos: nombre, correo, empresa, tipo de solicitud, asunto y mensaje.', 'Datos técnicos indispensables para sesión, seguridad, preferencias y funcionamiento de la aplicación.'] },
      { title: '2. Finalidades', bullets: ['Crear y operar la cuenta.', 'Ejecutar retos, validaciones y sistemas de recompensas.', 'Permitir funciones sociales y de organizaciones.', 'Gestionar campañas patrocinadas y revisiones de evidencia.', 'Atender soporte, requerimientos y solicitudes comerciales.', 'Prevenir fraude, abuso, farming y accesos no autorizados.', 'Mantener trazabilidad, seguridad y métricas operativas de la plataforma.'] },
      { title: '3. Evidencias y visibilidad', paragraphs: ['Las evidencias de retos se procesan para permitir la revisión por los participantes o responsables que correspondan al flujo del reto. DadoFit procura limitar el acceso según los roles, permisos y políticas de seguridad de la plataforma.', 'No se debe cargar evidencia que revele información sensible de terceros sin autorización o que no sea necesaria para demostrar el cumplimiento del reto.'] },
      { title: '4. Infraestructura y proveedores', paragraphs: ['DadoFit utiliza servicios tecnológicos de infraestructura, autenticación, base de datos y almacenamiento para operar la plataforma. Estos proveedores pueden procesar información únicamente en la medida necesaria para prestar sus servicios y conforme a sus condiciones aplicables.'] },
      { title: '5. Conservación', paragraphs: ['La información se conserva durante el tiempo necesario para prestar el servicio, mantener seguridad y trazabilidad, resolver disputas, cumplir obligaciones aplicables o atender solicitudes legítimas. Cuando corresponda, la información puede anonimizarse o eliminarse.'] },
      { title: '6. Seguridad', paragraphs: ['DadoFit combina controles de autenticación, permisos por workspace, políticas de acceso a datos, auditoría y validaciones del lado del servidor. Ningún sistema es infalible, por lo que también se espera que cada usuario proteja sus credenciales y reporte comportamientos sospechosos.'] },
      { title: '7. Derechos y solicitudes', bullets: ['Consultar la información asociada a su cuenta.', 'Solicitar correcciones o actualizaciones.', 'Solicitar eliminación o restricción cuando resulte aplicable.', 'Reportar un uso indebido o una preocupación de privacidad.', 'Solicitar información sobre el tratamiento mediante el canal de contacto de DadoFit.'] },
      { title: '8. Publicidad y Marcas', paragraphs: ['Los espacios publicitarios pueden mostrar campañas de terceros. Una campaña publicitaria no otorga por sí sola a un anunciante acceso a la información privada de los usuarios. Si en el futuro se incorporan tecnologías de seguimiento publicitario de terceros, esta política y los mecanismos de consentimiento deberán actualizarse.'] },
      { title: '9. Cambios y contacto', paragraphs: ['DadoFit puede actualizar esta política cuando cambien sus funcionalidades, proveedores o requisitos aplicables. Las consultas de privacidad se reciben mediante el formulario de contacto.'] },
    ],
  },
  cookies: {
    eyebrow: 'TECNOLOGÍAS DEL SITIO',
    title: 'Política de cookies y almacenamiento local',
    summary: 'Cómo DadoFit utiliza tecnologías del navegador para sesión, preferencias y funcionamiento del producto.',
    icon: Cookie,
    sections: [
      { title: '1. Qué tecnologías utiliza DadoFit', paragraphs: ['DadoFit puede utilizar almacenamiento local del navegador, tokens de sesión y otras tecnologías técnicas necesarias para recordar preferencias, mantener autenticación y operar funcionalidades. No toda esta información corresponde técnicamente a una cookie, pero se explica de forma conjunta para mayor transparencia.'] },
      { title: '2. Tecnologías esenciales', bullets: ['Mantener una sesión autenticada cuando corresponda.', 'Proteger el acceso a áreas restringidas.', 'Recordar datos indispensables para el funcionamiento de la experiencia.', 'Mantener continuidad técnica entre páginas y solicitudes.'] },
      { title: '3. Preferencias', bullets: ['Tema visual seleccionado.', 'Configuraciones de entrenamiento y filtros.', 'Preferencias de interfaz compatibles con la experiencia local.', 'Estados locales no sensibles necesarios para mejorar la continuidad de uso.'] },
      { title: '4. Publicidad', paragraphs: ['La existencia de espacios publicitarios directos dentro de DadoFit no implica necesariamente seguimiento de terceros. Si se integra en el futuro una red publicitaria o medición que utilice cookies no esenciales, DadoFit deberá actualizar esta política y aplicar los controles de consentimiento que correspondan.'] },
      { title: '5. Cómo controlar estas tecnologías', paragraphs: ['El usuario puede limpiar almacenamiento, cookies o datos del sitio desde la configuración de su navegador. Esto puede cerrar sesiones, restablecer preferencias o afectar determinadas funcionalidades.'] },
    ],
  },
  data: {
    eyebrow: 'GOBIERNO DE DATOS',
    title: 'Política de tratamiento de datos',
    summary: 'Principios y reglas operativas que orientan el tratamiento de datos personales dentro de DadoFit.',
    icon: Database,
    sections: [
      { title: '1. Principios', bullets: ['Finalidad: utilizar la información para propósitos definidos y legítimos relacionados con DadoFit.', 'Transparencia: explicar de forma comprensible los usos relevantes de la información.', 'Necesidad: procurar recolectar únicamente información relacionada con la operación del servicio.', 'Seguridad y confidencialidad: aplicar controles técnicos y organizativos razonables.', 'Calidad: permitir que la información de perfil pueda mantenerse actualizada.'] },
      { title: '2. Titulares y fuentes', paragraphs: ['Los datos pueden ser suministrados directamente por usuarios, representantes de Gyms u Organizaciones, representantes de Marcas, personas que envían solicitudes de contacto o generados por la interacción legítima con la plataforma.'] },
      { title: '3. Usos autorizados', bullets: ['Gestión de identidad, perfiles y autenticación.', 'Prestación de funcionalidades de entrenamiento y comunidad.', 'Retos, evidencias, revisiones y recompensas.', 'Operación de workspaces, roles, Gyms, Organizaciones y Marcas.', 'Atención de soporte, requerimientos, alianzas y publicidad.', 'Prevención de fraude, abuso, incidentes y vulneraciones de seguridad.', 'Auditoría y trazabilidad administrativa.'] },
      { title: '4. Derechos del titular', paragraphs: ['DadoFit habilita su canal de contacto para recibir solicitudes de consulta, actualización, corrección, eliminación, oposición o información sobre el tratamiento, en los casos en que resulten aplicables. La identidad del solicitante puede requerir validación antes de ejecutar cambios sensibles.'] },
      { title: '5. Transferencias y encargados tecnológicos', paragraphs: ['La operación puede involucrar proveedores tecnológicos que actúan como infraestructura o encargados de procesamiento. DadoFit procura limitar el acceso a lo necesario para la prestación del servicio y mantener controles de seguridad acordes con la arquitectura.'] },
      { title: '6. Incidentes y seguridad', paragraphs: ['Los eventos de seguridad o privacidad deben reportarse mediante el canal oficial de contacto. DadoFit puede investigar, limitar accesos, preservar registros de auditoría y adoptar medidas correctivas según la naturaleza del incidente.'] },
      { title: '7. Vigencia', paragraphs: ['Esta política se mantiene vigente mientras DadoFit procese información para las finalidades descritas y puede ser actualizada para reflejar cambios operativos, tecnológicos o regulatorios.'] },
    ],
  },
  community: {
    eyebrow: 'CONVIVENCIA Y JUEGO LIMPIO',
    title: 'Normas de comunidad',
    summary: 'DadoFit está diseñado para competir y progresar con juego limpio, seguridad y respeto entre Gymbros, Squads, Gyms y Marcas.',
    icon: UsersRound,
    sections: [
      { title: '1. Respeto primero', bullets: ['No se permite acoso, intimidación, discriminación, amenazas o ataques dirigidos a otros miembros.', 'Los desacuerdos sobre retos o evidencias deben resolverse mediante las herramientas de revisión y reporte, no mediante hostigamiento.'] },
      { title: '2. Evidencia real', bullets: ['No manipules fotografías, videos, tiempos, repeticiones o resultados para obtener aprobación.', 'No presentes evidencia de otra persona como propia.', 'No coordines retos ficticios para farmear XP, DadoCoins, Team Points o Sponsor Points.', 'Los controles antifarming pueden bloquear una recompensa aunque un reto haya sido completado.'] },
      { title: '3. Entrena con seguridad', paragraphs: ['No promuevas retos deliberadamente peligrosos ni presiones a otros miembros para realizar ejercicios incompatibles con su capacidad. La competencia nunca está por encima de la seguridad física.'] },
      { title: '4. Identidad y organizaciones', bullets: ['No suplantes personas, Gyms, empresas o Marcas.', 'Los roles de Owner, Admin, Coach y Member deben usarse únicamente para las funciones autorizadas.', 'Los administradores de una Organización no tienen privilegios globales sobre DadoFit.'] },
      { title: '5. Privacidad y contenido', bullets: ['No publiques datos personales de terceros sin autorización.', 'No cargues contenido ilegal, sexualmente explícito, violento fuera del contexto deportivo o que vulnere derechos de terceros.', 'Evita incluir información privada innecesaria dentro de evidencias.'] },
      { title: '6. Marcas y actividad comercial', paragraphs: ['La publicidad y los retos patrocinados deben utilizar los espacios y flujos autorizados por DadoFit. No se permite spam, captación engañosa, ofertas fraudulentas o uso comercial abusivo de la comunidad.'] },
      { title: '7. Aplicación de las reglas', paragraphs: ['Una infracción puede generar rechazo de evidencia, pérdida de elegibilidad para recompensas, limitación de funcionalidades, suspensión de una Organización o Marca, o suspensión de cuenta. Las decisiones administrativas relevantes pueden conservar trazabilidad en auditoría.'] },
      { title: '8. Reportes', paragraphs: ['Si detectas fraude, abuso, contenido riesgoso o un problema de seguridad, utiliza el formulario oficial de DadoFit y selecciona “Reportar un problema”.'] },
    ],
    notice: 'Juego limpio = progreso real. Las recompensas existen para reconocer actividad legítima, no para incentivar manipulación o riesgo físico.',
  },
};

export function LegalPage({ document }: { document: LegalDocument }) {
  const content = DOCUMENTS[document];
  const Icon = content.icon;
  return (
    <div className="legal-shell-v141">
      <header className="legal-topbar-v141">
        <Link to="/" className="legal-brand-v141"><span><Dice5 size={19}/></span><strong>DadoFit</strong></Link>
        <div><Link to="/contact">Contáctanos</Link><Link to="/login" className="legal-login-v141">Entrar</Link></div>
      </header>

      <main className="legal-page-v141">
        <Link className="legal-back-v141" to="/"><ArrowLeft size={15}/> Volver a DadoFit</Link>
        <section className="legal-hero-v141">
          <div className="legal-icon-v141"><Icon size={28}/></div>
          <div><span className="eyebrow">{content.eyebrow}</span><h1>{content.title}</h1><p>{content.summary}</p><small>Última actualización: septiembre de 2026</small></div>
        </section>

        {document === 'terms' && <div className="legal-safety-v141"><HeartPulse size={19}/><div><strong>Importante sobre actividad física</strong><span>DadoFit no reemplaza diagnóstico, tratamiento ni asesoría profesional de salud o entrenamiento.</span></div></div>}
        {document === 'data' && <div className="legal-safety-v141"><Scale size={19}/><div><strong>Canal para titulares</strong><span>Las solicitudes relacionadas con datos personales se reciben desde Contáctanos y pueden requerir validación de identidad.</span></div></div>}

        <section className="legal-content-v141">
          {content.sections.map((section) => (
            <article key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
            </article>
          ))}
        </section>

        {content.notice && <aside className="legal-notice-v141">{content.notice}</aside>}
        <section className="legal-help-v141"><ShieldCheck size={22}/><div><strong>¿Tienes una pregunta sobre este documento?</strong><p>Usa el canal oficial para soporte, privacidad, requerimientos o reportes.</p></div><Link to="/contact">Ir a Contáctanos</Link></section>
      </main>
    </div>
  );
}
