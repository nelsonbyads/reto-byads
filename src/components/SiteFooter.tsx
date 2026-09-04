import { Building2, Cookie, Dice5, Dumbbell, HeartHandshake, LifeBuoy, Megaphone, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import '../styles/v14.1-footer-legal.css';

const PRODUCT_LINKS = [
  { to: '/app', label: 'Entrenar' },
  { to: '/challenges', label: 'Retos 1 vs 1' },
  { to: '/gymbros', label: 'Gymbros' },
  { to: '/squads', label: 'Squads' },
  { to: '/sponsored-challenges', label: 'Retos patrocinados' },
];

const BUSINESS_LINKS = [
  { to: '/organizations', label: 'Organizaciones y Gyms' },
  { to: '/contact?type=brand_registration', label: 'Registrar una Marca' },
  { to: '/contact?type=gym_registration', label: 'Registrar un Gym' },
  { to: '/contact?type=advertising', label: 'Publicidad y alianzas' },
];

const SUPPORT_LINKS = [
  { to: '/contact', label: 'Contáctanos' },
  { to: '/contact?type=support', label: 'Ayuda y soporte' },
  { to: '/contact?type=report', label: 'Reportar un problema' },
  { to: '/community-guidelines', label: 'Normas de comunidad' },
];

const LEGAL_LINKS = [
  { to: '/terms', label: 'Términos y condiciones' },
  { to: '/privacy', label: 'Política de privacidad' },
  { to: '/data-policy', label: 'Tratamiento de datos' },
  { to: '/cookies', label: 'Política de cookies' },
];

function AuthLegalFooter() {
  return (
    <footer className="auth-legal-footer-v1411" aria-label="Información legal de DadoFit">
      <div className="auth-legal-footer-inner-v1411">
        <div className="auth-legal-trust-v1411">
          <span className="auth-legal-icon-v1411"><ShieldCheck size={16}/></span>
          <div>
            <strong>Tu privacidad y tus datos importan</strong>
            <p>Antes de ingresar puedes consultar cómo DadoFit trata tus datos y utiliza tecnologías de almacenamiento.</p>
          </div>
        </div>
        <nav aria-label="Enlaces legales previos al acceso">
          <Link to="/terms">Términos</Link>
          <Link to="/privacy">Privacidad</Link>
          <Link to="/data-policy">Tratamiento de datos</Link>
          <Link to="/cookies"><Cookie size={12}/> Cookies</Link>
          <Link to="/community-guidelines">Comunidad</Link>
          <Link to="/contact">Contáctanos</Link>
        </nav>
      </div>
      <div className="auth-legal-footer-copy-v1411">© {new Date().getFullYear()} DadoFit · FITNESS + GAME</div>
    </footer>
  );
}

export function SiteFooter() {
  const location = useLocation();
  const isAuth = location.pathname === '/login' || location.pathname === '/register';
  const hidden = location.pathname === '/' || location.pathname === '/business-setup' || location.pathname.startsWith('/admin');

  if (hidden) return null;
  if (isAuth) return <AuthLegalFooter/>;

  return (
    <footer className={`site-footer-v141${location.pathname === '/app' ? ' site-footer-workout-v141' : ''}`}>
      <div className="site-footer-accent-v141" aria-hidden="true" />
      <div className="site-footer-inner-v141">
        <section className="site-footer-brand-v141" aria-label="DadoFit">
          <Link to="/" className="site-footer-logo-v141">
            <span><Dice5 size={22}/></span>
            <div><strong>DadoFit</strong><small>FITNESS + GAME</small></div>
          </Link>
          <p>Entrena, compite y conecta con una comunidad fitness donde los retos, los Gyms y las Marcas conviven en un mismo ecosistema.</p>
          <div className="site-footer-pill-row-v141">
            <span><Dumbbell size={13}/> Entrenamiento</span>
            <span><UsersRound size={13}/> Comunidad</span>
            <span><Sparkles size={13}/> Patrocinios</span>
          </div>
        </section>

        <nav className="site-footer-nav-v141" aria-label="Producto">
          <h2><Dumbbell size={15}/> Producto</h2>
          {PRODUCT_LINKS.map((item) => <Link key={item.to} to={item.to}>{item.label}</Link>)}
        </nav>

        <nav className="site-footer-nav-v141" aria-label="Empresas">
          <h2><Building2 size={15}/> Empresas</h2>
          {BUSINESS_LINKS.map((item) => <Link key={item.to} to={item.to}>{item.label}</Link>)}
        </nav>

        <nav className="site-footer-nav-v141" aria-label="Soporte">
          <h2><LifeBuoy size={15}/> Soporte</h2>
          {SUPPORT_LINKS.map((item) => <Link key={item.to} to={item.to}>{item.label}</Link>)}
        </nav>

        <nav className="site-footer-nav-v141" aria-label="Legal">
          <h2><ShieldCheck size={15}/> Legal</h2>
          {LEGAL_LINKS.map((item) => <Link key={item.to} to={item.to}>{item.label}</Link>)}
        </nav>
      </div>

      <div className="site-footer-commercial-v141">
        <div className="site-footer-commercial-copy-v141">
          <span><Megaphone size={15}/> DADOFIT FOR BRANDS</span>
          <strong>¿Quieres activar tu marca dentro de una comunidad fitness?</strong>
          <p>Campañas patrocinadas, retos de marca e inventario publicitario responsive.</p>
        </div>
        <Link to="/contact?type=advertising">Hablemos de pauta <HeartHandshake size={17}/></Link>
      </div>

      <div className="site-footer-bottom-v141">
        <p>© {new Date().getFullYear()} DadoFit. Todos los derechos reservados.</p>
        <p className="site-footer-reward-note-v141">DadoCoins son puntos de fidelización dentro de DadoFit; no son criptomonedas, dinero ni tienen retiro en efectivo.</p>
        <div>
          <Link to="/terms">Términos</Link>
          <Link to="/privacy">Privacidad</Link>
          <Link to="/cookies">Cookies</Link>
          <Link to="/contact">Contacto</Link>
        </div>
      </div>
    </footer>
  );
}
