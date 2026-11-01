#!/usr/bin/env python3
"""Import offline first-party affiliate tables; never run during game matching.

Download Fubo's public Zendesk article JSON and Nexstar's station-page HTML,
then pass their paths. No network access or third-party Python modules needed.
"""
import argparse
import html
import json
import re
from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'services/games/data'
FUBO = 'https://support.fubo.tv/hc/en-us/articles/115005151127-What-Local-Channels-does-Fubo-Carry'
NEXSTAR = 'https://www.nexstar.tv/stations/'
NETWORKS = {'ABC': 'ABC', 'CBS': 'CBS', 'NBC': 'NBC', 'FOX': 'FOX', 'CW': 'The CW', 'The CW': 'The CW', 'CW+': 'The CW'}


class TableRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        if tag in ('td', 'th'):
            self.cell = ''
        if tag == 'br' and self.cell is not None:
            self.cell += '|'

    def handle_data(self, value):
        if self.cell is not None:
            self.cell += value

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            if self.row is not None:
                self.row.append(' '.join(html.unescape(self.cell).split()))
            self.cell = None
        if tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def table_rows(value):
    parser = TableRows()
    parser.feed(value)
    return parser.rows


def callsign(value):
    # License suffixes and a bare DT suffix do not encode a subchannel. DT2/D2 do.
    match = re.fullmatch(r'([KW][A-Z]{2,3})(?:-(TV|DT|LD|CD)|DT)?\*?', value)
    return match.group(1) if match else None


def cities_for(market):
    value = re.sub(r'\s*\(\d+\)', '', market)
    value = re.sub(r',\s*[A-Z]{2}(?=\b)', '', value)
    value = re.sub(r'\bFt\.?\s+', 'Fort ', value)
    value = re.sub(r'\bSt\.?\s+', 'St ', value)
    value = value.replace('D.C.', 'DC')
    # Split multi-city labels; preserve the original labels in marketNames.
    return sorted(set(part.strip(' ,') for part in re.split(r'\s*(?:/|\(|\)|\s-\s|-)\s*', value) if part.strip(' ,')))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fubo', type=Path, required=True)
    parser.add_argument('--nexstar', type=Path, required=True)
    parser.add_argument('--checked-at', required=True, help='YYYY-MM-DD inspection date')
    parser.add_argument('--output', type=Path, default=DATA / 'nfl-affiliates.json')
    args = parser.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.checked_at):
        parser.error('--checked-at must be YYYY-MM-DD')
    overrides = json.loads((DATA / 'local-station-overrides.json').read_text())
    document = json.loads((DATA / 'nfl-affiliates.json').read_text())
    fubo = json.loads(args.fubo.read_text())['article']
    raw_rows = table_rows(fubo['body'])
    nexstar_rows = table_rows(args.nexstar.read_text())
    if len(raw_rows) < 500 or len(nexstar_rows) < 100:
        raise ValueError('Source table incomplete or structure changed; no output written')
    stations = {}
    skipped = set()

    def add(call, network, market, source, **extra):
        key = (call, network)
        canonical = overrides['marketAliases'].get(market, market)
        station = stations.setdefault(key, {'callsign': call, 'network': network, 'market': canonical, 'marketNames': [], 'cities': [], 'sourceUrls': []})
        station['marketNames'] = sorted(set(station['marketNames'] + [market]))
        station['cities'] = sorted(set(station['cities'] + cities_for(market)))
        station['states'] = sorted(set(station.get('states', []) + re.findall(r'\b[A-Z]{2}\b', market)))
        if source not in station['sourceUrls']:
            station['sourceUrls'].append(source)
        station.update(extra)
        return station

    for row in raw_rows:
        if len(row) < 3 or row[0] not in NETWORKS:
            continue
        call = callsign(row[1])
        if not call:
            skipped.add(row[1])
            continue
        station = add(call, NETWORKS[row[0]], row[2], FUBO)
        suffix = re.search(r'-(TV|DT|LD|CD)$', row[1])
        if not suffix and re.fullmatch(r'[KW][A-Z]{2,3}DT', row[1]):
            suffix = re.search(r'(DT)$', row[1])
        if suffix:
            station['licenseSuffixes'] = sorted(set(station.get('licenseSuffixes', []) + [suffix.group(1)]))

    primaries = {}
    for row in nexstar_rows:
        if row[0] == 'Market':
            continue
        if len(row) != 8:
            raise ValueError(f'Unexpected Nexstar table row: {row}')
        station_cells, affiliations, virtuals = [[part.strip() for part in row[index].split('|')] for index in (3, 4, 6)]
        if len(station_cells) != len(affiliations) or len(affiliations) != len(virtuals):
            raise ValueError(f'Misaligned Nexstar cells: {row[0]}')
        call = None
        for raw_call, affiliation, virtual in zip(station_cells, affiliations, virtuals):
            if raw_call:
                call = callsign(raw_call)
            if not call or not affiliation:
                continue
            primary = re.fullmatch(r'(\d{1,2})(?:\.1)?', virtual)
            network = NETWORKS.get(affiliation)
            if primary:
                if call in primaries and primaries[call] != network:
                    raise ValueError(f'Conflicting primary affiliation: {call}')
                primaries[call] = network
            if network:
                extra = {'number': int(primary.group(1)), 'numberSourceUrl': NEXSTAR, 'primary': True} if primary else {'requiresNetworkLabel': True}
                add(call, network, row[0], NEXSTAR, **extra)

    for entry in overrides['stations']:
        extra = {key: value for key, value in entry.items() if key not in ('callsign', 'network', 'market', 'sourceUrls')}
        for source in entry['sourceUrls']:
            add(entry['callsign'], entry['network'], entry['market'], source, **extra)
        if entry.get('primary'):
            primaries[entry['callsign']] = entry['network']

    grouped = defaultdict(list)
    for station in stations.values():
        grouped[station['callsign']].append(station)
    for call, entries in grouped.items():
        for station in entries:
            # A service on a secondary subchannel must not inherit primary number.
            if call in primaries:
                if station['network'] == primaries[call]:
                    station['primary'] = True
                    station.pop('requiresNetworkLabel', None)
                else:
                    station.pop('primary', None)
                    station.pop('number', None)
                    station.pop('numberSourceUrl', None)
                    station['requiresNetworkLabel'] = True
            elif len(entries) > 1:
                station['requiresNetworkLabel'] = True
            station['cities'] = sorted(set(station['cities'] + overrides.get('cityAliases', {}).get(station['market'], [])))

    document['checkedAt'] = args.checked_at
    document['sources'].update(stations=FUBO, nexstar=NEXSTAR)
    document['stations'] = sorted(stations.values(), key=lambda item: (item['network'], item['market'], item['callsign']))
    document['stationCoverage'] = {'services': len(stations), 'callsigns': len(grouped), 'numberedServices': sum('number' in s for s in stations.values()),
        'networks': {network: sum(s['network'] == network for s in stations.values()) for network in sorted(set(NETWORKS.values()))},
        'excludedSourceIdentifiers': sorted(skipped), 'fuboUpdatedAt': fubo.get('updated_at')}
    sections = []
    for key, value in document.items():
        if key == 'stations':
            rows = ',\n'.join('    ' + json.dumps(station, separators=(',', ':'), ensure_ascii=False) for station in value)
            sections.append('  \"stations\": [\n' + rows + '\n  ]')
        else:
            sections.append(json.dumps({key: value}, indent=2, ensure_ascii=False)[2:-2])
    args.output.write_text('{\n' + ',\n'.join(sections) + '\n}\n')
    print(json.dumps(document['stationCoverage'], indent=2))


if __name__ == '__main__':
    main()
