/**
 * SISTEMA DE DETECCIÓN AUTOMÁTICA DE JUEGOS - UpGames
 * Detecta automáticamente cuando se publica un juego conocido (GTA V, Fortnite, etc.)
 * y agrega un botón "Comprar" con el link oficial de la tienda
 */

// Base de datos de juegos conocidos con sus links oficiales
const GAMES_DATABASE = {
  // 🎮 AAA GAMES (Grandes lanzamientos)
  'GTA V': {
    name: 'Grand Theft Auto V',
    platform: 'pc',
    purchaseLink: 'https://www.rockstargames.com/gta/online/buy',
    steamLink: 'https://store.steampowered.com/app/271590/Grand_Theft_Auto_V/',
    epicLink: 'https://www.epicgames.com/store/en-US/p/grand-theft-auto-v',
    consoleLinks: {
      ps5: 'https://store.playstation.com/en-us/product/UP1004-PPSA01606_00-GTAVDIGITALCODE0',
      xbox: 'https://www.xbox.com/en-US/games/store/grand-theft-auto-v/BNZ7F8NQZ59J'
    },
    keywords: ['gta 5', 'gtav', 'gta 5', 'grand theft auto 5', 'gta five']
  },
  'Fortnite': {
    name: 'Fortnite',
    platform: 'multi',
    purchaseLink: 'https://www.fortnite.com/en-US/buy-v-bucks',
    epicLink: 'https://www.epicgames.com/fortnite/en-US/download',
    steamLink: 'https://store.steampowered.com/app/1172620/Fortnite/',
    keywords: ['fortnite', 'battle royale']
  },
  'Valorant': {
    name: 'Valorant',
    platform: 'pc',
    purchaseLink: 'https://playvalorant.com/en-us/buy',
    epicLink: 'https://www.epicgames.com/games/valorant',
    keywords: ['valorant', 'riot games']
  },
  'PUBG': {
    name: 'PLAYERUNKNOWN\'S BATTLEGROUNDS',
    platform: 'multi',
    purchaseLink: 'https://www.pubg.com/en-us/buy',
    steamLink: 'https://store.steampowered.com/app/578080/PLAYERUNKNOWNS_BATTLEGROUNDS/',
    epicLink: 'https://www.epicgames.com/store/en-US/p/playerunknown-s-battlegrounds',
    keywords: ['pubg', 'battlegrounds', 'playerunknown']
  },
  'Call of Duty': {
    name: 'Call of Duty',
    platform: 'multi',
    purchaseLink: 'https://www.callofduty.com/buy',
    steamLink: 'https://store.steampowered.com/app/2402360/Call_of_Duty_Modern_Warfare_II/',
    battleNetLink: 'https://www.blizzard.com/en-us/games/cod/',
    keywords: ['call of duty', 'cod', 'warzone', 'modern warfare']
  },
  'Minecraft': {
    name: 'Minecraft',
    platform: 'multi',
    purchaseLink: 'https://www.minecraft.net/en-us/download',
    microsoftStoreLink: 'https://www.microsoft.com/en-us/store/games/minecraft-launcher',
    steamLink: 'https://store.steampowered.com/app/432160/Minecraft/',
    javaLink: 'https://launcher.mojang.com/download/Minecraft.exe',
    keywords: ['minecraft']
  },
  'The Elder Scrolls V': {
    name: 'The Elder Scrolls V: Skyrim',
    platform: 'multi',
    purchaseLink: 'https://www.elderscrolls.com/en-us/',
    steamLink: 'https://store.steampowered.com/app/72850/The_Elder_Scrolls_V_Skyrim/',
    epicLink: 'https://www.epicgames.com/store/en-US/p/the-elder-scrolls-v-skyrim',
    keywords: ['skyrim', 'elder scrolls', 'tes']
  },
  'Elden Ring': {
    name: 'Elden Ring',
    platform: 'multi',
    purchaseLink: 'https://www.eldenring.com/',
    steamLink: 'https://store.steampowered.com/app/570940/ELDEN_RING/',
    epicLink: 'https://www.epicgames.com/store/en-US/p/elden-ring',
    keywords: ['elden ring', 'fromsoft']
  },
  'Cyberpunk 2077': {
    name: 'Cyberpunk 2077',
    platform: 'multi',
    purchaseLink: 'https://www.cyberpunk.net/en/buy',
    steamLink: 'https://store.steampowered.com/app/1091500/Cyberpunk_2077/',
    epicLink: 'https://www.epicgames.com/store/en-US/p/cyberpunk-2077',
    goGLink: 'https://www.gog.com/game/cyberpunk_2077',
    keywords: ['cyberpunk', '2077', 'cd projekt']
  },
  'League of Legends': {
    name: 'League of Legends',
    platform: 'pc',
    purchaseLink: 'https://www.leagueoflegends.com/en-us/buy-rp/',
    riotLink: 'https://www.leagueoflegends.com/en-us/',
    keywords: ['league of legends', 'lol', 'riot']
  },
  'Dota 2': {
    name: 'Dota 2',
    platform: 'pc',
    purchaseLink: 'https://www.dota2.com/store',
    steamLink: 'https://store.steampowered.com/app/570590/Dota_2/',
    keywords: ['dota 2', 'dota', 'valve']
  },
  'Counter-Strike': {
    name: 'Counter-Strike 2',
    platform: 'pc',
    purchaseLink: 'https://www.counter-strike.net/cs2',
    steamLink: 'https://store.steampowered.com/app/730/CounterStrike_2/',
    keywords: ['counter-strike', 'cs2', 'csgo', 'cs:go']
  },
  'FIFA': {
    name: 'EA Sports FC',
    platform: 'multi',
    purchaseLink: 'https://www.easportsfc.com/buy',
    steamLink: 'https://store.steampowered.com/app/2868140/EA_SPORTS_FC_24/',
    playStationLink: 'https://store.playstation.com/en-us/product/UP0006-PPSA02184_00-EASCF24FULL0000',
    keywords: ['ea sports fc', 'fifa', 'football', 'soccer']
  },
  'Hogwarts Legacy': {
    name: 'Hogwarts Legacy',
    platform: 'multi',
    purchaseLink: 'https://www.hogwartslegacy.com/en-us/buy',
    steamLink: 'https://store.steampowered.com/app/990080/Hogwarts_Legacy/',
    epicLink: 'https://www.epicgames.com/store/en-US/p/hogwarts-legacy',
    keywords: ['hogwarts legacy', 'harry potter', 'wizarding']
  },
  'Baldur\'s Gate 3': {
    name: 'Baldur\'s Gate 3',
    platform: 'multi',
    purchaseLink: 'https://baldursgate3.game/',
    steamLink: 'https://store.steampowered.com/app/1238140/Baldurs_Gate_3/',
    psLink: 'https://store.playstation.com/en-us/product/UP0839-PPSA02159_00-BG3GAMEPS500XXX',
    keywords: ['baldur\'s gate 3', 'bg3', 'larian']
  },

  // 🎮 INDIE GAMES
  'Terraria': {
    name: 'Terraria',
    platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/105600/Terraria/',
    steamLink: 'https://store.steampowered.com/app/105600/Terraria/',
    epicLink: 'https://www.epicgames.com/store/en-US/p/terraria',
    keywords: ['terraria', '2d minecraft']
  },
  'Stardew Valley': {
    name: 'Stardew Valley',
    platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/413150/Stardew_Valley/',
    steamLink: 'https://store.steampowered.com/app/413150/Stardew_Valley/',
    keywords: ['stardew valley', 'farming game']
  },
  'Hollow Knight': {
    name: 'Hollow Knight',
    platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/367520/Hollow_Knight/',
    steamLink: 'https://store.steampowered.com/app/367520/Hollow_Knight/',
    keywords: ['hollow knight', 'metroidvania']
  },
  'Among Us': {
    name: 'Among Us',
    platform: 'multi',
    purchaseLink: 'https://store.steampowered.com/app/945360/Among_Us/',
    steamLink: 'https://store.steampowered.com/app/945360/Among_Us/',
    keywords: ['among us', 'impostor']
  },

  // 🎮 JUEGOS MOBILE
  'PUBG Mobile': {
    name: 'PUBG Mobile',
    platform: 'mobile',
    purchaseLink: 'https://www.pubgmobile.com/en/',
    googlePlay: 'https://play.google.com/store/apps/details?id=com.tencent.ig',
    appStore: 'https://apps.apple.com/us/app/pubg-mobile/id1330123141',
    keywords: ['pubg mobile', 'mobile battle royale']
  },
  'Candy Crush': {
    name: 'Candy Crush Saga',
    platform: 'mobile',
    purchaseLink: 'https://www.king.com/game/candycrush',
    googlePlay: 'https://play.google.com/store/apps/details?id=com.king.candycrush',
    appStore: 'https://apps.apple.com/us/app/candy-crush-saga/id553834731',
    keywords: ['candy crush']
  },
  'COD Mobile': {
    name: 'Call of Duty: Mobile',
    platform: 'mobile',
    purchaseLink: 'https://www.callofduty.com/mobile',
    googlePlay: 'https://play.google.com/store/apps/details?id=com.activision.callofduty.shooter',
    appStore: 'https://apps.apple.com/us/app/call-of-duty-mobile/id1442393434',
    keywords: ['cod mobile', 'call of duty mobile']
  }
};

/**
 * Detecta si un título coincide con un juego conocido
 * Usa búsqueda difusa para detectar variaciones (mods, optimizados, etc.)
 */
function detectGame(title, description = '') {
  if (!title) return null;

  const searchText = (title + ' ' + description).toLowerCase();
  
  // Búsqueda exacta primero
  for (const [gameKey, gameData] of Object.entries(GAMES_DATABASE)) {
    const keywords = gameData.keywords || [];
    
    // Buscar palabras clave exactas
    for (const keyword of keywords) {
      if (searchText.includes(keyword)) {
        return {
          detected: true,
          gameName: gameData.name,
          gameKey: gameKey,
          platform: gameData.platform,
          purchaseLink: gameData.purchaseLink,
          allLinks: gameData
        };
      }
    }
  }

  // Si no encontró coincidencia exacta, retorna null
  return null;
}

/**
 * Obtiene el link más apropiado según la plataforma del usuario
 */
function getBestPurchaseLink(gameData, userPlatform = 'pc') {
  const links = gameData.allLinks;
  
  // Prioridad de links según plataforma
  const priorities = {
    pc: ['purchaseLink', 'steamLink', 'epicLink', 'goGLink', 'battleNetLink'],
    mobile: ['googlePlay', 'appStore', 'purchaseLink'],
    console: ['consoleLinks', 'psLink', 'xboxLink', 'purchaseLink'],
    multi: ['purchaseLink', 'steamLink', 'epicLink', 'googlePlay', 'appStore']
  };

  const userPriorities = priorities[userPlatform] || priorities.multi;

  for (const linkType of userPriorities) {
    if (links[linkType]) {
      // Si es un objeto (como consoleLinks), retorna el primer value
      if (typeof links[linkType] === 'object' && links[linkType] !== null) {
        const firstLink = Object.values(links[linkType])[0];
        if (firstLink) return firstLink;
      } else if (typeof links[linkType] === 'string') {
        return links[linkType];
      }
    }
  }

  return links.purchaseLink || null;
}

/**
 * Enriquece un documento Juego con info de detección de juego
 */
function enrichGameData(juegoDocument) {
  const detected = detectGame(juegoDocument.title, juegoDocument.description);
  
  if (detected) {
    // Agregar al extraData para persistencia
    juegoDocument.extraData = juegoDocument.extraData || {};
    juegoDocument.extraData.detectedGame = {
      gameName: detected.gameName,
      gameKey: detected.gameKey,
      platform: detected.platform,
      purchaseLink: detected.purchaseLink,
      bestLink: getBestPurchaseLink(detected, 'pc')
    };
  }

  return juegoDocument;
}

module.exports = {
  detectGame,
  getBestPurchaseLink,
  enrichGameData,
  GAMES_DATABASE
};
