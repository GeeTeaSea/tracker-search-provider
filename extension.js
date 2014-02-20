/* Tracker Search Provider for Gnome Shell
 *
 * 2012 Contributors Christian Weber, Felix Schultze, Martyn Russell
 * 2014 Florian Miess
 *
 * This programm is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 *
 * Version 1.5
 *
 * https://github.com/cewee/tracker-search
 * 
 * 
 * Version 1.6
 * https://github.com/hamiller/tracker-search-provider
 * 
 */

const Main          = imports.ui.main;
const Clutter 		= imports.gi.Clutter;
const Search        = imports.ui.search;
const SearchDisplay = imports.ui.searchDisplay;
const Gio           = imports.gi.Gio;
const GLib          = imports.gi.GLib;
const IconGrid      = imports.ui.iconGrid;
const Util          = imports.misc.util;
const Tracker       = imports.gi.Tracker;
const St            = imports.gi.St;
const Atk 	        = imports.gi.Atk;
const Lang          = imports.lang;

/* let xdg-open pick the appropriate program to open/execute the file */
const DEFAULT_EXEC = 'xdg-open';
/* Limit search results, since number of displayed items is limited */
const MAX_RESULTS = 10;
const MAX_ROWS =3; // this is currently ignored, but bug report is filed : https://bugzilla.gnome.org/show_bug.cgi?id=675527
const ICON_SIZE = 50;

const CategoryType = {
    FTS : 0,
    FILES : 1,
    FOLDERS : 2
};

const TrackerResult = new Lang.Class({
    Name: 'TrackerResult',

   _init: function(resultMeta) {
        this.actor = new St.Bin({
            style_class: 'result',
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_role: Atk.Role.PUSH_BUTTON
        });

        var MainBox = new St.BoxLayout( { style_class: 'result-content', vertical: true });

        this.icon = new IconGrid.BaseIcon(resultMeta.filename);
        this.actor.child = this.icon.actor;
        this.actor.label_actor = this.icon.label;

        this.actor.set_child(MainBox);
        var icon = resultMeta.createIcon(ICON_SIZE);
        // View for regular files
        if (resultMeta.contentType != "inode/directory" ) {
            let title = new St.Label({ text: resultMeta.name, style_class: 'title' });
            MainBox.add(title, { x_fill: false, x_align: St.Align.START });
            let IconInfoFrame = new St.BoxLayout({ style_class: 'icon-info-frame', vertical: false });
            let IconBox = new St.BoxLayout({ vertical: false });
            MainBox.add(IconInfoFrame, { x_fill: false, x_align: St.Align.START, y_align: St.Align.MIDDLE });
            IconBox.add(icon, { x_fill: false, y_fill: false, x_align: St.Align.START, y_align: St.Align.MIDDLE });
            IconInfoFrame.add(IconBox, { x_fill: false, x_align: St.Align.START });
            let SideBox = new St.BoxLayout({ style_class: 'side-box', vertical: true });
            IconInfoFrame.add(SideBox, { x_fill: false, x_align: St.Align.START });
            let fileName = new St.Label({ text: resultMeta.filename, style_class: 'result-detail' });
            SideBox.add(fileName, { x_fill: false, x_align: St.Align.START });
            let lastMod = new St.Label({ text: resultMeta.lastMod, style_class: 'result-detail' });
            SideBox.add(lastMod, { x_fill: false, x_align: St.Align.START });
            let prettyPath = new St.Label({ text: resultMeta.prettyPath, style_class: 'result-path' });
            MainBox.add(prettyPath, { x_fill: false, x_align: St.Align.START });
        } else { // View for folder elements
            let titleDir = new St.Label({ text: resultMeta.name, style_class: 'titleDir' });
            MainBox.add(titleDir, { x_fill: false, y_fill: true, x_align: St.Align.START, y_align: St.Align.MIDDLE });
            let prettyPath = new St.Label({ text: resultMeta.prettyPath, style_class: 'result-pathDir' });
            MainBox.add(prettyPath, { x_fill: false, x_align: St.Align.START });
            MainBox.add(icon, { x_fill: false, y_fill: false, x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE });
        }
    }

});

var trackerSearchProviderFiles = null;
var trackerSearchProviderFolders = null;


const TrackerSearchProvider = new Lang.Class({
    Name : 'TrackerSearchProvider',

    _init : function(title, categoryType) {
	    this._categoryType = categoryType;
		this._title = title;
		this.id = 'tracker-search-' + title;
    },



    _getResultMeta : function(resultId) {
        let type = resultId.contentType;
        let name = resultId.name;
        let path = resultId.path;
        let filename = resultId.filename;
        let lastMod = resultId.lastMod;
        let contentType = resultId.contentType;
        let prettyPath = resultId.prettyPath;
        return {
            'id':       resultId,
            'name':     name,
            'path':     path,
            'filename': filename,
            'lastMod':  lastMod,
            'prettyPath':  prettyPath,
            'contentType': contentType,
            'createIcon' : function(size) {
                let icon = Gio.app_info_get_default_for_type(type,null).get_icon();
                return imports.gi.St.TextureCache.get_default().load_gicon(null, icon, size);
            }
         };
    },

    _getQuery : function (terms) {
    	var query = "";

    	if (this._categoryType == CategoryType.FTS) {
    	    var terms_in_sparql = "";

            for (var i = 0; i < terms.length; i++) {
        		if (terms_in_sparql.length > 0) terms_in_sparql += " ";
    		    terms_in_sparql += terms[i] + "*";
            }
    	    // Technically, the tag should really be matched
    	    // separately not as one phrase too.
    	    query += "SELECT ?urn nie:url(?urn) tracker:coalesce(nie:title(?urn), nfo:fileName(?urn)) nie:url(?parent) nfo:fileLastModified(?urn) WHERE { { ";
       	    query += " ?urn a nfo:FileDataObject .";
       	    query += " ?urn fts:match \"" + terms_in_sparql + "\" } UNION { ?urn nao:hasTag ?tag . FILTER (fn:contains (fn:lower-case (nao:prefLabel(?tag)), \"" + terms + "\")) }";
       	    query += " OPTIONAL { ?urn nfo:belongsToContainer ?parent .  ?r2 a nfo:Folder . FILTER(?r2 = ?urn). } . FILTER(!BOUND(?r2)). } ORDER BY DESC(nfo:fileLastModified(?urn)) ASC(nie:title(?urn)) OFFSET 0 LIMIT " + String(MAX_RESULTS);
       	    //  ?r2 a nfo:Folder . FILTER(?r2 = ?urn). } . FILTER(!BOUND(?r2) is supposed to filter out folders, but this fails for 'root' folders in which is indexed (as 'Music', 'Documents' and so on ..) - WHY?

    	} else if (this._categoryType == CategoryType.FILES) {
    	    // TODO: Do we really want this?
    	} else if (this._categoryType == CategoryType.FOLDERS) {
    	    query += "SELECT ?urn nie:url(?urn) tracker:coalesce(nie:title(?urn), nfo:fileName(?urn)) nie:url(?parent) nfo:fileLastModified(?urn) WHERE {";
    	    query += "  ?urn a nfo:Folder .";
    	    query += "  FILTER (fn:contains (fn:lower-case (nfo:fileName(?urn)), '" + terms + "')) .";
    	    query += "  ?urn nfo:belongsToContainer ?parent ;";
    	    query += "  tracker:available true .";
    	    query += "} ORDER BY DESC(nfo:fileLastModified(?urn)) DESC(nie:contentCreated(?urn)) ASC(nie:title(?urn)) OFFSET 0 LIMIT " + String(MAX_RESULTS);
    	}

    	return query;
    },

    createResultObject: function (result, terms) {
        let result = new TrackerResult(result);
        return result;
    },


    getResultMetas: function(resultIds, callback) {
        let metas = [];
        for (let i = 0; i < resultIds.length; i++) {
            metas.push(this._getResultMeta(resultIds[i]));
        }
        callback(metas);
    },

    activateResult : function(result) {
        // Action executed when clicked on result
        var uri = result.id;
        var f = Gio.file_new_for_uri(uri);
        var fileName = f.get_path();
        Util.spawn([DEFAULT_EXEC, fileName]);
    },

    _getResultSet: function (cursor) {
    	let results = [];

        try {
            while (cursor != null && cursor.next(null)) {
                var urn = cursor.get_string(0)[0];
                var uri = cursor.get_string(1)[0];
                var title = cursor.get_string(2)[0];
                var parentUri = cursor.get_string(3)[0];
                var lastMod = cursor.get_string(4)[0];
                var lastMod = "Modified: " + lastMod.split('T')[0];
                var filename = decodeURI(uri.split('/').pop());
                // if file does not exist, it won't be shown
        		var f = Gio.file_new_for_uri(uri);

        		if(!f.query_exists(null)) {continue;}

        		var path = f.get_path();
		        // clean up path
                var prettyPath = path.substr(0,path.length - filename.length).replace("/home/" + GLib.get_user_name() , "~");
                // contentType is an array, the index "1" set true,
                // if function is uncertain if type is the right one
                let contentType = Gio.content_type_guess(path, null);
                var newContentType = contentType[0];
                if(contentType[1]){
                    if(newContentType == "application/octet-stream") {
                        let fileInfo = Gio.file_new_for_path(path).query_info('standard::type', 0, null);
                        // for some reason 'content_type_guess' returns a wrong mime type for folders
                        if(fileInfo.get_file_type() == Gio.FileType.DIRECTORY) {
                            newContentType = "inode/directory";
                        } else {
                            // unrecognized mime-types are set to text, so that later an icon can be picked
                            newContentType = "text/x-log";
                        }
                    };
                }
                results.push({
                    'id' : uri,
                    'name' : title,
                    'path' : path,
                    'filename': filename,
                    'lastMod' : lastMod,
                    'prettyPath' : prettyPath,
                    'contentType' : newContentType
                });
            };
        } catch (error) {
            global.log("TrackerSearchProvider: Could not traverse results cursor: " + error.message);
        }
        //print("Tracker _getResultSet found : " + results.length);
        this.searchSystem.setResults(this, results);
    },

    getInitialResultSet : function(terms) {
        // terms holds array of search items
        // check if 1st search term is >2 letters else drop the request
        if(terms[0].length < 3) {
            return [];
        }

        try {
            var conn = Tracker.SparqlConnection.get(null);
        	var query = this._getQuery(terms);
            var cursor = conn.query(query, null);
        } catch (error) {
            global.log("Querying Tracker failed. Please make sure you have the --GObject Introspection-- package for Tracker installed.");
            global.log(error.message);
        }
        this._getResultSet(cursor);
        return [];
    },

    getSubsearchResultSet : function(previousResults, terms) {
        // check if 1st search term is >2 letters else drop the request
        if(terms[0].length < 3) {
            return [];
        }
        this.getInitialResultSet(terms);
        return [];
    },

    filterResults : function(results, max) {
        return results.slice(0, max);
    }
});

function init(meta) {
}

function enable() {
	if (!trackerSearchProviderFolders){
    	trackerSearchProviderFolders = new TrackerSearchProvider("FOLDERS", CategoryType.FOLDERS);
    	Main.overview.addSearchProvider(trackerSearchProviderFolders);
	}

	if (!trackerSearchProviderFiles) {
    	trackerSearchProviderFiles = new TrackerSearchProvider("FILES", CategoryType.FTS);
    	Main.overview.addSearchProvider(trackerSearchProviderFiles);
	}
}

function disable() {
    if (trackerSearchProviderFiles){
		Main.overview.removeSearchProvider(trackerSearchProviderFiles);
    	trackerSearchProviderFiles = null;
    }

    if (trackerSearchProviderFolders) {
    	Main.overview.removeSearchProvider(trackerSearchProviderFolders);
    	trackerSearchProviderFolders = null;
    }
}


