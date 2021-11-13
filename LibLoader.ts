/*
The MIT License (MIT)
Copyright (c) 2014 Joel Takvorian
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/// <reference path="q/Q.d.ts" />
import MpdClient = require('./MpdClient');
import q = require('q');

"use strict";

class LibLoader {
    static loaded: boolean = false;
    static loadingCounter: number = 0;
    static tree: Tree;
    static treeDescriptor: string[];

    static loadOnce(res, treeDescriptor: string[]) {
        if (this.loaded) {
            // Already loaded, no need to load again.
            // Note that if the treeDescriptor has changed, client should use "reload" instead
            res.send({status: "OK", numberOfItems: this.loadingCounter});
        } else {
            this.treeDescriptor = treeDescriptor;
            var that = this;
            loadAllLib(treeDescriptor).then(function(json: Tree) {
                that.tree = json;
                that.loaded = true;
                res.send({status: "OK", numberOfItems: that.loadingCounter});
            }).done();
        }
    }

    static reload(res, treeDescriptor: string[]) {
        this.loaded = false;
        this.loadingCounter = 0;
        this.tree = undefined;
        this.loadOnce(res, treeDescriptor);
    }

    static getPage(res, start: number, count: number) {
        if (this.loaded) {
            var page: PageSeekerInfo = seekSongsForPage({songs: [], start: start, count: count, treeInfo: {}, treeDescriptor: this.treeDescriptor}, this.tree.root, 0);
            var subTree: Tree = organizeJsonLib(page.songs, this.treeDescriptor);
            res.send({status: "OK", data: subTree.root});
        } else {
            res.send({status: "Error: loading still in progress"}).end();
        }
    }

    static progress(res) {
        res.send(new String(this.loadingCounter));
    }
}
export = LibLoader;

interface Tree {
    root: any;
}

interface SongInfo {
    file: string;
    lastModified?: string;
    time?: number;
    artist?: string;
    albumArtist?: string;
    title?: string;
    album?: string;
    track?: string;
    date?: string;
    genre?: string;
    composer?: string;
    display?: string;
}

interface ParserInfo {
    songs: SongInfo[];
    lines: string[];
    cursor: number;
}

function loadAllLib(treeDescriptor: string[]): q.Promise<Tree> {
    var tree = loadDirForLib([], "")
        .then(function(parser: ParserInfo) {
            return organizeJsonLib(parser.songs, treeDescriptor);
        });
    return tree;
}

function loadDirForLib(songs: SongInfo[], dir: string): q.Promise<ParserInfo> {
    return MpdClient.exec("lsinfo \"" + dir + "\"")
        .then(function(response: string) {
            var lines: string[] = response.split("\n");
            return parseNext({ songs: songs, lines: lines, cursor: 0 });
        });
}

/*
    EXAMPLE OF DATA returned by MPD
    directory: USB
    directory: WEBRADIO
    playlist: rock
    Last-Modified: 2014-07-06T12:05:51Z

    OTHER EXAMPLE
    file: USB\/Musics\/myFile.mp3
    Last-Modified: 2013-09-15T07:33:08Z
    Time: 202
    Artist: An artist
    AlbumArtist: An artist
    Title: My song
    Album: An album
    Track: 1
    Date: 2004
    Genre: Rock
    file: USB\/Musics\/anotherFile.mp3
    Last-Modified: 2013-09-15T07:33:14Z
    Time: 242
    Artist: An artist
    AlbumArtist: An artist
    Title: Another song
    Album: An album
    Track: 1
    Date: 2004
    Genre: Rock
*/
function parseNext(parser: ParserInfo): q.Promise<ParserInfo> {
    var currentSong: SongInfo = null;
    for (; parser.cursor < parser.lines.length; parser.cursor++) {
        var elts = parser.lines[parser.cursor].split(": ");
        var key = elts[0];
        var value = elts[1];
        if (key == "file") {
            var currentSong: SongInfo = { "file": value };
            parser.songs.push(currentSong);
            LibLoader.loadingCounter++;
        } else if (key == "directory") {
            currentSong = null;
            // Load (async) the directory content, and then only continue on parsing what remains here
            return loadDirForLib(parser.songs, value)
                .then(function(subParser: ParserInfo) {
                    // this "subParser" contains gathered songs, whereas the existing "parser" contains previous cursor information that we need to continue on this folder
                    return parseNext({ songs: subParser.songs, lines: parser.lines, cursor: parser.cursor + 1 });
                });
        } else if (key == "playlist") {
            // skip
            currentSong = null;
        } else if (currentSong != null) {
            if (key == "Last-Modified") {
                currentSong.lastModified = value;
            } else if (key == "Time") {
                currentSong.time = +value;
            } else if (key == "Artist") {
                currentSong.artist = value;
            } else if (key == "AlbumArtist") {
                currentSong.albumArtist = value;
            } else if (key == "Title") {
                currentSong.title = value;
            } else if (key == "Album") {
                currentSong.album = value;
            } else if (key == "Track") {
                currentSong.track = value;
            } else if (key == "Date") {
                currentSong.date = value;
            } else if (key == "Genre") {
                currentSong.genre = value;
            } else if (key == "Composer") {
                currentSong.composer = value;
            }
        }
    }
    // Did not find any sub-directory, return directly this data
    return q.fcall<ParserInfo>(function() {
        return parser;
    });
}

// Returns a custom object tree corresponding to the descriptor
function organizeJsonLib(flat: SongInfo[], treeDescriptor: string[]): Tree {
    var tree = {};
    flat.forEach(function(song: SongInfo) {
        var treePtr: any = tree;
        var depth = 1;
        treeDescriptor.forEach(function(key: string) {
            var valueForKey: any = song[key];
            if (valueForKey === undefined) {
                valueForKey = "";
            }
            if (!treePtr[valueForKey]) {
                if (depth == treeDescriptor.length) {
                    treePtr[valueForKey] = [];
                } else {
                    treePtr[valueForKey] = {};
                }
            }
            treePtr = treePtr[valueForKey];
            depth++;
        });
        var display: string = song.display
            || (song.track ? song.track + " - " : "") + song.title;
        treePtr.push({"file": song.file, "display": display});
    });
    return {root: tree};
}

interface PageSeekerInfo {
    songs: SongInfo[];
    start: number;
    count: number;
    treeInfo: any;
    treeDescriptor: string[];
}

function seekSongsForPage(info: PageSeekerInfo, treePtr: any, depth: number): PageSeekerInfo {
    var ret: PageSeekerInfo = {
        songs: info.songs,
        start: info.start,
        count: info.count,
        treeInfo: info.treeInfo,
        treeDescriptor: info.treeDescriptor
    };

    if (depth == ret.treeDescriptor.length) {
        // songs are in this level
        var nbSongsHere: number = treePtr.length;
        if (nbSongsHere > ret.start) {
            // There's songs to be added here
            var nbSongsToAdd: number = Math.min(nbSongsHere - ret.start, ret.count - ret.songs.length);
            var splice: SongInfo[] = treePtr.slice(ret.start, ret.start + nbSongsToAdd);
            splice.forEach(function(song: SongInfo) {
                for (var tag in ret.treeInfo) {
                    song[tag] = ret.treeInfo[tag];
                }
            });
            ret.songs = ret.songs.concat(splice);
        }
        ret.start = Math.max(0, ret.start - nbSongsHere);
    } else {
        // go deeper
        for (var item in treePtr) {
            ret.treeInfo[ret.treeDescriptor[depth]] = item;
            ret = seekSongsForPage(ret, treePtr[item], depth + 1);
            if (ret.songs.length == ret.count) {
                return ret;
            }
        }
    }
    return ret;
}
