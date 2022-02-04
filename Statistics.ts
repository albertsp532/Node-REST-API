/*
The MIT License (MIT)
Copyright (c) 2014 Joel Takvorian, https://github.com/jotak/mipod
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
import MpdStatus = require('./MpdStatus');
import MpdEntries = require('./MpdEntries');
import MpdEntry = require('./libtypes/MpdEntry');
import TagsMap = require('./libtypes/TagsMap');
import ItemTags = require('./libtypes/ItemTags');
import ThemeTags = require('./libtypes/ThemeTags');
import TagTarget = require('./libtypes/TagTarget');
import lib = require('./Library');
//import tools = require('./tools');
import q = require('q');

"use strict";

class Statistics {

    private lastPlayed: string = "";

    constructor(public library: lib.Library) {
        this.idleLoop();
    }

    private idleOnce(): q.Promise<void> {
        var that = this;
        return MpdClient.idle()
            .then(MpdClient.current)
            .then(MpdEntries.readEntries)
            .then(function(entries: MpdEntry[]) {
                if (entries.length > 0 && entries[0].song) {
                    return entries[0].song.file;
                }
                return null;
            })
            .then(function(file) {
                if (that.lastPlayed != file) {
                    that.nowPlaying(file);
                }
            });
    }

    private idleLoop() {
        var that = this;
        this.idleOnce().then(function() {
            that.idleLoop();
        });
    }

    private nowPlaying(file: string) {
        var tagTimes: string = "times";
        var tagLast: string = "last";
        var targets: TagTarget[] = [];
        targets.push({
            targetType: "song",
            target: file
        });

        var that = this;
        this.library.readTag(tagTimes, targets).then(function(tag: ThemeTags) {
            if (tag.hasOwnProperty("song")
                    && tag["song"].hasOwnProperty(file)
                    && tag["song"][file].hasOwnProperty(tagTimes)) {
                try {
                    var times: number = +tag["song"][file][tagTimes];
                    that.library.writeTag(tagTimes, String(times+1), targets);
                } catch (err) {
                    console.log("Could not write tag " + tagTimes + " on " + file);
                    console.log(err);
                }
            }
        });
        this.library.writeTag(tagLast, String(new Date()), targets)
    }
}
export = Statistics;
