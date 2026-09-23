// Choix du thème, lu avant le premier affichage.
// « systeme » suit le réglage de Windows ; « clair » et « sombre » l'imposent.
(function () {
  var choix = 'systeme';
  try {
    choix = localStorage.getItem('icity.theme') || 'systeme';
  } catch (e) {
    /* stockage indisponible (navigation privée) : on suit le système */
  }
  var sombre = choix === 'sombre' || (choix === 'systeme' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = sombre ? 'dark' : 'light';
})();
