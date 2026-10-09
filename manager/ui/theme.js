// Theme choisi a la main (bouton de l'en-tete), sinon celui du systeme.
(function () {
  try {
    var t = localStorage.getItem('mgrTheme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* stockage indisponible : theme systeme */ }
}());
