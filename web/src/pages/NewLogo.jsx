import { Link } from "react-router-dom";
import { NewLogoMark } from "../components/new-logo-mark";
import "./new-logo.css";

export default function NewLogo() {
  return (
    <main className="new-logo-page">
      <header className="new-logo-header">
        <span className="new-logo-header-label">Dogmedia / Identity study</span>
        <Link to="/" className="new-logo-back">Kembali ke aplikasi <span aria-hidden="true">↗</span></Link>
      </header>

      <section className="new-logo-hero" aria-labelledby="new-logo-heading">
        <div className="new-logo-intro">
          <span className="new-logo-kicker">01 / Audio signal</span>
          <h1 id="new-logo-heading">Satu ritme.<br />Satu identitas.</h1>
          <p>Dua lengkung membawa gelombang suara menuju tombol play. Merah muda mengikuti aksen player Dogmedia, sementara titik pada nama menghubungkannya dengan wordmark yang sudah dipakai di situs.</p>
        </div>
        <div className="new-logo-hero-art" aria-label="Pratinjau logo utama">
          <NewLogoMark className="new-logo-primary" />
        </div>
      </section>

      <section className="new-logo-variants" aria-label="Pratinjau penggunaan logo">
        <div className="new-logo-variant new-logo-variant-light">
          <span className="new-logo-variant-caption">Light / wordmark</span>
          <NewLogoMark className="new-logo-variant-wordmark" />
          <span className="new-logo-variant-note">Koleksimu. Ceritamu. Ritmemu.</span>
        </div>
        <div className="new-logo-variant new-logo-variant-dark">
          <span className="new-logo-variant-caption">Dark / wordmark</span>
          <NewLogoMark className="new-logo-variant-wordmark" />
          <span className="new-logo-variant-note">Your media. Your space.</span>
        </div>
        <div className="new-logo-variant new-logo-variant-icon">
          <span className="new-logo-variant-caption">App / symbol</span>
          <NewLogoMark className="new-logo-icon-only" showName={false} />
          <span className="new-logo-variant-note">Dibangun dari span + CSS.</span>
        </div>
      </section>
    </main>
  );
}
