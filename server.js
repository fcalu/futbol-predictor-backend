// backend/server.js
require('dotenv').config(); // Carga las variables de entorno desde .env
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de la API-Football
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY; // Clave obtenida de .env
const RAPIDAPI_HOST = "api-football-v1.p.rapidapi.com";
const API_BASE_URL = `https://${RAPIDAPI_HOST}/v3`;

// Instancia de Axios configurada para la API-Football
const apiFootball = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST,
    },
});

// ======================================================
// === MIDDLEWARE DE LA APLICACIÓN ===
// ======================================================

// PRIMERO: Middleware para parsear cuerpos JSON (¡ESENCIAL PARA req.body!)
app.use(express.json()); 
// SEGUNDO: Middleware CORS
app.use(cors()); 

// Middleware para depuración (opcional, puedes quitarlo después)
app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.url} - Content-Type: ${req.headers['content-type']}`);
    next();
});

// ======================================================
// === FUNCIONES PARA OBTENER DATOS DE LA API-FOOTBALL ===
// ======================================================

/**
 * Obtiene partidos futuros de una liga y temporada.
 * @param {number} leagueId - ID de la liga.
 * @param {number} season - Año de la temporada.
 * @param {number} next - Número de partidos futuros a obtener.
 * @returns {Promise<object>} Datos de partidos.
 */
const fetchFixtures = async (leagueId, season, next = 5) => {
    try {
        const response = await apiFootball.get('/fixtures', {
            params: {
                league: leagueId,
                season: season,
                next: next,
                timezone: 'America/Mexico_City',
            },
        });
         // --- LOG PARA VER LA RESPUESTA DE LA API-FOOTBALL (FETCH FIXTURES) ---
        console.log(`📡 [API-Football] Respuesta para /fixtures (Liga:${leagueId}, Temp:${season}):`);
        console.log(`   Resultados: ${response.data.results}, Errores: ${response.data.errors ? JSON.stringify(response.data.errors) : 'Ninguno'}, Partidos: ${response.data.response ? response.data.response.length : 0}`);
        // ------------------------------------------------------------------
        if (response.data.errors && Object.keys(response.data.errors).length > 0) {
            const apiErrorMessage = Object.values(response.data.errors).join(', ');
            throw new Error(`API-Football Error: ${apiErrorMessage}`);
        }
        return response.data;
    } catch (error) {
        console.error("❌ Error al obtener partidos de API-Football:", error.message);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(`API-Football HTTP Error ${error.response.status}: ${error.response.statusText || JSON.stringify(error.response.data)}`);
        } else if (axios.isAxiosError(error) && error.request) {
            throw new Error('API-Football Network Error: No response received from server.');
        } else {
            throw new Error(`API-Football Unknown Error: ${error.message}`);
        }
    }
};

/**
 * Obtiene estadísticas detalladas de un equipo para una liga y temporada específica.
 * @param {number} teamId - ID del equipo.
 * @param {number} leagueId - ID de la liga.
 * @param {number} season - Año de la temporada.
 * @returns {Promise<object>} Datos de estadísticas del equipo.
 */
const getTeamStatistics = async (teamId, leagueId, season) => {
    try {
        const response = await apiFootball.get('/teams/statistics', {
            params: {
                team: teamId,
                league: leagueId,
                season: season,
            },
        });
        // --- LOG PARA VER LA RESPUESTA DE LA API-FOOTBALL (GET TEAM STATS) ---
        console.log(`📊 [API-Football] Respuesta para /teams/statistics (Equipo:${teamId}, Liga:${leagueId}, Temp:${season}):`);
        console.log(`   Resultados: ${response.data.results}, Errores: ${response.data.errors ? JSON.stringify(response.data.errors) : 'Ninguno'}, Data: ${response.data.response ? response.data.response.length : 0}`);
        // ------------------------------------------------------------------
        if (response.data.errors && Object.keys(response.data.errors).length > 0) {
            const apiErrorMessage = Object.values(response.data.errors).join(', ');
            throw new Error(`API-Football Error: ${apiErrorMessage}`);
        }
        if (response.data.response && response.data.response.length > 0) {
            return response.data.response[0];
        }
        throw new Error(`No statistics found for team ${teamId} in league ${leagueId} season ${season}`);
    } catch (error) {
        console.error(`Error al obtener estadísticas del equipo ${teamId}:`, error.message);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(`API-Football HTTP Error ${error.response.status}: ${error.response.statusText || JSON.stringify(error.response.data)}`);
        } else if (axios.isAxiosError(error) && error.request) {
            throw new Error('API-Football Network Error: No response received from server.');
        } else {
            throw new Error(`Fallo al obtener estadísticas del equipo: ${error.message}`);
        }
    }
};

/**
 * Obtiene la clasificación (standings) de una liga para una temporada específica.
 * @param {number} leagueId - ID de la liga.
 * @param {number} season - Año de la temporada.
 * @returns {Promise<object>} Datos de clasificación de la liga.
 */
const getStandings = async (leagueId, season) => {
    try {
        const response = await apiFootball.get('/standings', {
            params: {
                league: leagueId,
                season: season,
            },
        });
        if (response.data.errors && Object.keys(response.data.errors).length > 0) {
            const apiErrorMessage = Object.values(response.data.errors).join(', ');
            throw new Error(`API-Football Error: ${apiErrorMessage}`);
        }
        if (response.data.response && response.data.response.length > 0 && response.data.response[0].league.standings.length > 0) {
            return response.data.response[0].league.standings[0];
        }
        throw new Error(`No standings found for league ${leagueId} season ${season}`);
    } catch (error) {
        console.error(`Error al obtener clasificaciones para la liga ${leagueId}, temporada ${season}:`, error.message);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(`API-Football HTTP Error ${error.response.status}: ${error.response.statusText || JSON.stringify(error.response.data)}`);
        } else if (axios.isAxiosError(error) && error.request) {
            throw new Error('API-Football Network Error: No response received from server.');
        } else {
            throw new Error(`Fallo al obtener clasificaciones: ${error.message}`);
        }
    }
};

// ===========================================
// === FUNCIONES PARA EL MODELO DE PREDICIÓN ===
// ===========================================

function factorial(n) { /* ... */ return 1;} // Implementación ya proporcionada
function poissonPMF(k, lambda) { /* ... */ return 0;} // Implementación ya proporcionada
function parseForm(formString) { /* ... */ return { win: 0, draw: 0, lose: 0 };} // Implementación ya proporcionada

/**
 * Genera una predicción de partido utilizando un modelo simplificado basado en Poisson.
 * Obtiene estadísticas de temporadas anteriores si no están disponibles para la temporada actual.
 * @param {number} homeTeamId - ID del equipo local.
 * @param {number} awayTeamId - ID del equipo visitante.
 * @param {number} leagueId - ID de la liga del partido actual (ej. 253 para 2025).
 * @param {number} season - Año de la temporada del partido actual (ej. 2025).
 * @returns {Promise<object>} Objeto con las predicciones del partido.
 */
async function getMatchPrediction(homeTeamId, awayTeamId, leagueId, season) {
    let homeTeamStatsRes;
    let awayTeamStatsRes;
    let leagueStandingsRes;
    let statsSeasonUsed = season;

    const seasonsToTry = [season];
    if (season > 2000) {
        seasonsToTry.push(season - 1);
        seasonsToTry.push(season - 2);
    }

    let statsFetchedSuccessfully = false;

    for (const s of seasonsToTry) {
        try {
            console.log(`Intentando obtener estadísticas para liga ${leagueId}, temporada ${s}...`);
            homeTeamStatsRes = await getTeamStatistics(homeTeamId, leagueId, s);
            awayTeamStatsRes = await getTeamStatistics(awayTeamId, leagueId, s);
            leagueStandingsRes = await getStandings(leagueId, s);

            statsSeasonUsed = s;
            statsFetchedSuccessfully = true;
            console.log(`✅ Estadísticas obtenidas para temporada: ${statsSeasonUsed}`);
            break;
        } catch (error) {
            console.warn(`⚠️ Fallo al obtener estadísticas para liga ${leagueId}, temporada ${s}: ${error.message}. Intentando siguiente temporada...`);
        }
    }

    if (!statsFetchedSuccessfully || !homeTeamStatsRes || !awayTeamStatsRes || !leagueStandingsRes) {
        throw new Error(`No se pudieron obtener estadísticas válidas para los equipos en las temporadas intentadas (${seasonsToTry.join(', ')}).`);
    }

    const homeTeamName = homeTeamStatsRes.team?.name || 'Equipo Local';
    const awayTeamName = awayTeamStatsRes.team?.name || 'Equipo Visitante';

    const homePlayedHome = homeTeamStatsRes.fixtures?.played?.home || 1;
    const homeGoalsForHome = homeTeamStatsRes.goals?.for?.home || 0;
    const homeGoalsAgainstHome = homeTeamStatsRes.goals?.against?.home || 0;

    const awayPlayedAway = awayTeamStatsRes.fixtures?.played?.away || 1;
    const awayGoalsForAway = awayTeamStatsRes.goals?.for?.away || 0;
    const awayGoalsAgainstAway = awayTeamStatsRes.goals?.against?.away || 0;

    let totalLeagueGoals = 0;
    let totalLeagueMatches = 0;
    if (leagueStandingsRes && Array.isArray(leagueStandingsRes)) {
        for (const team of leagueStandingsRes) {
            if (team.all) {
                totalLeagueGoals += team.all.goals.for + team.all.goals.against;
                totalLeagueMatches += team.all.played;
            }
        }
    }
    const leagueAvgGoalsPerMatch = totalLeagueMatches > 0 ? totalLeagueGoals / totalLeagueMatches : 2.5;

    const homeAttackStrength = (homeGoalsForHome / homePlayedHome) / (leagueAvgGoalsPerMatch || 1);
    const homeDefenseStrength = (homeGoalsAgainstHome / homePlayedHome) / (leagueAvgGoalsPerMatch || 1);

    const awayAttackStrength = (awayGoalsForAway / awayPlayedAway) / (leagueAvgGoalsPerMatch || 1);
    const awayDefenseStrength = (awayGoalsAgainstAway / awayPlayedAway) / (leagueAvgGoalsPerMatch || 1);

    const HOME_ADVANTAGE_FACTOR = 1.2;

    const expectedGoalsHome = homeAttackStrength * (1 / awayDefenseStrength) * HOME_ADVANTAGE_FACTOR;
    const expectedGoalsAway = awayAttackStrength * (1 / homeDefenseStrength);

    const lambdaHome = isNaN(expectedGoalsHome) || !isFinite(expectedGoalsHome) ? 1.5 : Math.max(0.1, expectedGoalsHome);
    const lambdaAway = isNaN(expectedGoalsAway) || !isFinite(expectedGoalsAway) ? 1.0 : Math.max(0.1, expectedGoalsAway);

    const maxGoalsConsidered = 5;
    let homeWinProb = 0;
    let awayWinProb = 0;
    let drawProb = 0;
    let bttsProb = 0;
    let over2_5Prob = 0;

    for (let hg = 0; hg <= maxGoalsConsidered; hg++) {
        for (let ag = 0; ag <= maxGoalsConsidered; ag++) {
            const probHomeGoals = poissonPMF(hg, lambdaHome);
            const probAwayGoals = poissonPMF(ag, lambdaAway);
            const scoreProb = probHomeGoals * probAwayGoals;

            if (hg > ag) homeWinProb += scoreProb;
            else if (ag > hg) awayWinProb += scoreProb;
            else drawProb += scoreProb;

            if (hg > 0 && ag > 0) bttsProb += scoreProb;
            if (hg + ag > 2.5) over2_5Prob += scoreProb;
        }
    }

    const totalResultProb = homeWinProb + awayWinProb + drawProb;
    if (totalResultProb > 0) {
        homeWinProb /= totalResultProb;
        awayWinProb /= totalResultProb;
        drawProb /= totalResultProb;
    } else {
        homeWinProb = 0.33; awayWinProb = 0.33; drawProb = 0.34;
    }

    let predictedWinnerName = "Empate";
    let advice = `Predicción basada en nuestro modelo de IA/Bayes (estadísticas de la temporada ${statsSeasonUsed}).`;

    const maxResultProb = Math.max(homeWinProb, awayWinProb, drawProb);

    if (maxResultProb === homeWinProb) {
        predictedWinnerName = homeTeamName;
        advice = `${homeTeamName} es el favorito según el modelo (estadísticas de la temporada ${statsSeasonUsed}).`;
    } else if (maxResultProb === awayWinProb) {
        predictedWinnerName = awayTeamName;
        advice = `${awayTeamName} es el favorito según el modelo (estadísticas de la temporada ${statsSeasonUsed}).`;
    } else if (maxResultProb === drawProb) {
        predictedWinnerName = "Empate";
        advice = `El modelo sugiere un partido muy parejo con alta probabilidad de empate (estadísticas de la temporada ${statsSeasonUsed}).`;
    }

    if (bttsProb > 0.5) {
        advice += " Se espera que ambos equipos anoten.";
    } else {
        advice += " Es probable que un equipo no anote o el partido termine 0-0.";
    }
    if (over2_5Prob > 0.5) {
        advice += " Se anticipan más de 2.5 goles en total.";
    } else {
        advice += " Se anticipan menos de 2.5 goles en total.";
    }

    const homeComparisonForm = homeTeamStatsRes.form ? parseForm(homeTeamStatsRes.form) : { win: 0, draw: 0, lose: 0 };
    const awayComparisonForm = awayTeamStatsRes.form ? parseForm(awayTeamStatsRes.form) : { win: 0, draw: 0, lose: 0 };

    const totalHomeFormGames = homeComparisonForm.win + homeComparisonForm.draw + homeComparisonForm.lose;
    const totalAwayFormGames = awayComparisonForm.win + awayComparisonForm.draw + awayComparisonForm.lose;

    return {
        predictions: {
            advice: advice,
            winner: { name: predictedWinnerName },
            btts: bttsProb > 0.5,
            under_over: over2_5Prob > 0.5 ? '+2.5' : '-2.5',
            goals: {
                home: lambdaHome.toFixed(2),
                away: lambdaAway.toFixed(2),
            },
            percent: {
                home: (homeWinProb * 100).toFixed(0) + '%',
                draw: (drawProb * 100).toFixed(0) + '%',
                away: (awayWinProb * 100).toFixed(0) + '%',
            },
        },
        comparison: {
            form: {
                home: totalHomeFormGames > 0 ? ((homeComparisonForm.win + homeComparisonForm.draw / 2) / totalHomeFormGames * 100).toFixed(0) + "%" : "50%",
                away: totalAwayFormGames > 0 ? ((awayComparisonForm.win + awayComparisonForm.draw / 2) / totalAwayFormGames * 100).toFixed(0) + "%" : "50%"
            },
            att: {
                home: ((lambdaHome / (lambdaHome + lambdaAway)) * 100).toFixed(0) + "%",
                away: ((lambdaAway / (lambdaHome + lambdaAway)) * 100).toFixed(0) + "%"
            },
            def: {
                home: ((lambdaAway / (lambdaHome + lambdaAway)) * 100).toFixed(0) + "%",
                away: ((lambdaHome / (lambdaHome + lambdaAway)) * 100).toFixed(0) + "%"
            },
            poisson_distribution: {
                home: (homeWinProb * 100).toFixed(0) + "%",
                away: (awayWinProb * 100).toFixed(0) + "%"
            },
            h2h: { home: "50%", away: "50%" },
            goals: {
                home: ((homeGoalsForHome / (homeGoalsForHome + awayGoalsForAway)) * 100).toFixed(0) + "%",
                away: ((awayGoalsForAway / (homeGoalsForHome + awayGoalsForAway)) * 100).toFixed(0) + "%"
            },
            total: {
                home: ((homeWinProb + (drawProb / 2)) * 100).toFixed(0) + "%",
                away: ((awayWinProb + (drawProb / 2)) * 100).toFixed(0) + "%"
            },
        },
    };
}

// =======================
// === ENDPOINTS DE LA API ===
// =======================

// Endpoint para obtener partidos futuros
app.get('/api/all-fixtures', async (req, res) => {
    const league = parseInt(req.query.league || 39);
    const season = parseInt(req.query.season || 2025);
    const next = parseInt(req.query.next || 10);

    try {
        const data = await fetchFixtures(league, season, next);
        if (!data.response || data.response.length === 0) {
            return res.json({ response: [], message: "No se encontraron partidos para la liga/temporada especificada." });
        }
        res.json(data);
    } catch (error) {
        console.error("❌ Error en el endpoint /api/all-fixtures:", error.message);
        let details = error.message;
        try {
            const parsedError = JSON.parse(error.message);
            if (parsedError && typeof parsedError === 'object' && Object.keys(parsedError).length > 0) {
                details = parsedError;
            }
        } catch (e) {
            // Not a JSON error, use original message
        }
        res.status(500).json({ error: 'Fallo al obtener partidos', details: details });
    }
});

// Nuevo Endpoint para obtener predicciones personalizadas
app.post('/api/predict-match', async (req, res) => {
    const { homeTeamId, awayTeamId, leagueId, season } = req.body; // Line 409:13 if code lines up

    if (!homeTeamId || !awayTeamId || !leagueId || !season) {
        return res.status(400).json({ error: 'Faltan parámetros requeridos: homeTeamId, awayTeamId, leagueId, season' });
    }

    try {
        const prediction = await getMatchPrediction(homeTeamId, awayTeamId, leagueId, season);
        res.json(prediction);
    } catch (error) {
        console.error('Error en /api/predict-match:', error.message);
        let details = error.message;
        if (axios.isAxiosError(error) && error.response) {
            details = error.response.data || error.message;
        }
        res.status(500).json({ error: 'Fallo al generar la predicción', details: details });
    }
});

// ===================
// === INICIO DEL SERVIDOR ===
// ===================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor backend corriendo en http://0.0.0.0:${PORT}`);
    console.log(`🔑 Clave API cargada: ${RAPIDAPI_KEY ? 'Sí' : 'No (verifica .env)'}`);
    if (!RAPIDAPI_KEY) {
        console.warn('⚠️ ADVERTENCIA: La clave RAPIDAPI_KEY no está configurada. Las llamadas a la API-Football fallarán.');
    }
});