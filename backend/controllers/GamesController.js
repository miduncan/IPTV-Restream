const { validateGamesSettings } = require('../services/games/GamesSettings');

function createGamesController(service) {
    return {
        async list(_req, res) {
            await service.refreshStatus();
            return res.json(service.getGames({ sidebar: true }));
        },
        history(req, res) {
            if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
            return res.json(service.getMatchingHistory());
        },
        async categories(req, res) {
            if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
            try { return res.json(await service.getMatchingCategories()); }
            catch { return res.status(502).json({ error: 'Could not load matching categories. Check the provider settings and try again.' }); }
        },
        updateCategories(req, res) {
            if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
            const ids = req.body?.allowedCategoryIds;
            if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length) {
                return res.status(400).json({ error: 'Allowed categories must be a unique list of category IDs' });
            }
            try { return res.json(service.updateCategoryPolicy(ids)); }
            catch { return res.status(500).json({ error: 'Could not save matching categories' }); }
        },
        getCandidates(req, res) {
            const result = service.getGameMatching(req.params.gameId);
            if (!result) {
                return res.status(404).json({ error: 'Game not found' });
            }
            return res.json(result);
        },
        runMatching(req, res) {
            if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required to run matching' });
            void service.runMatching();
            return res.status(202).json({ matching: service.getMatchingStatus() });
        },
        cancelMatching(req, res) {
            if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required to cancel matching' });
            return res.status(202).json({ matching: service.cancelMatching() });
        },
        getSettings(req, res) {
            if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
            return res.json({ settings: service.getSettings() });
        },
        updateSettings(req, res) {
            if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
            const error = validateGamesSettings(req.body?.settings);
            if (error) return res.status(400).json({ error });
            try {
                return res.json({ settings: service.updateSettings(req.body.settings) });
            } catch {
                return res.status(500).json({ error: 'Could not save Games settings' });
            }
        },
    };
}

module.exports = { createGamesController };
